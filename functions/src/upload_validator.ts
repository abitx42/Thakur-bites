import { logSecurityEvent } from './security_logger';

export type ValidatedFileType = 'JPEG' | 'PNG' | 'WEBP' | 'PDF';

export interface FileValidationResult {
  isValid: boolean;
  detectedType?: ValidatedFileType;
  mimeType?: string;
  rejectionReason?: string;
  hasActiveContent?: boolean;
  isExecutable?: boolean;
}

// Dangerous active PDF tokens
const DANGEROUS_PDF_TOKENS = [
  /\/JavaScript/i,
  /\/JS\s*[<\[(]/i,
  /\/Launch/i,
  /\/EmbeddedFiles/i,
  /\/SubmitForm/i,
  /\/ImportData/i,
  /\/RichMedia/i,
];

// Dangerous script tags in polyglot files
const DANGEROUS_HTML_TOKENS = [
  /<script\b/i,
  /<svg\b/i,
  /<\?xml\b/i,
  /<!doctype\s+html/i,
  /<html\b/i,
  /\bonerror\s*=/i,
  /\bonload\s*=/i,
];

/**
 * Sniffs binary buffer headers to determine the genuine file format
 * and detect executable or active script payloads.
 */
export function validateFileBuffer(buffer: Buffer): FileValidationResult {
  if (!buffer || buffer.length < 4) {
    return {
      isValid: false,
      rejectionReason: 'File buffer is empty or too short (< 4 bytes).',
    };
  }

  // 1. Check for Executable Signatures (Immediate Reject)
  // Windows PE / MZ: 4D 5A ('MZ')
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      isValid: false,
      isExecutable: true,
      rejectionReason: 'Executable Windows PE binary rejected.',
    };
  }

  // Linux ELF: 7F 45 4C 46 ('\x7fELF')
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return {
      isValid: false,
      isExecutable: true,
      rejectionReason: 'Executable Linux ELF binary rejected.',
    };
  }

  // macOS Mach-O: FE ED FA CE, FE ED FA CF, CF FA ED FE, CE FA ED FE
  const isMachO =
    (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf)) ||
    (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) ||
    (buffer[0] === 0xce && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe);
  if (isMachO) {
    return {
      isValid: false,
      isExecutable: true,
      rejectionReason: 'Executable macOS Mach-O binary rejected.',
    };
  }

  // Java Class / Bytecode: CA FE BA BE
  if (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) {
    return {
      isValid: false,
      isExecutable: true,
      rejectionReason: 'Java bytecode / class file rejected.',
    };
  }

  // Shell script / shebang: 23 21 ('#!')
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return {
      isValid: false,
      isExecutable: true,
      rejectionReason: 'Shell script rejected.',
    };
  }

  // 2. Identify Legitimate File Types via Magic Bytes

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    // Scan preview chunk for HTML/SVG polyglot tags
    const sample = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('latin1');
    for (const token of DANGEROUS_HTML_TOKENS) {
      if (token.test(sample)) {
        return {
          isValid: false,
          hasActiveContent: true,
          rejectionReason: 'JPEG file contains embedded script/HTML polyglot payload.',
        };
      }
    }

    return {
      isValid: true,
      detectedType: 'JPEG',
      mimeType: 'image/jpeg',
      hasActiveContent: false,
      isExecutable: false,
    };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('latin1');
    for (const token of DANGEROUS_HTML_TOKENS) {
      if (token.test(sample)) {
        return {
          isValid: false,
          hasActiveContent: true,
          rejectionReason: 'PNG file contains embedded script/HTML polyglot payload.',
        };
      }
    }

    return {
      isValid: true,
      detectedType: 'PNG',
      mimeType: 'image/png',
      hasActiveContent: false,
      isExecutable: false,
    };
  }

  // WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return {
      isValid: true,
      detectedType: 'WEBP',
      mimeType: 'image/webp',
      hasActiveContent: false,
      isExecutable: false,
    };
  }

  // PDF: %PDF- (25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    // Deep scan of PDF content for active executable objects
    const pdfText = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString('latin1');

    for (const token of DANGEROUS_PDF_TOKENS) {
      if (token.test(pdfText)) {
        return {
          isValid: false,
          detectedType: 'PDF',
          hasActiveContent: true,
          rejectionReason: `PDF document contains prohibited active executable content or script (${token.source}).`,
        };
      }
    }

    return {
      isValid: true,
      detectedType: 'PDF',
      mimeType: 'application/pdf',
      hasActiveContent: false,
      isExecutable: false,
    };
  }

  return {
    isValid: false,
    rejectionReason: 'Unsupported or unverified file format. Only true JPEG, PNG, WebP, or non-active PDF files are permitted.',
  };
}

/**
 * Validates a storage proof file directly in Cloud Storage.
 * If invalid or malicious, automatically purges the file immediately from Cloud Storage
 * and logs a security incident.
 */
export async function validateAndQuarantineFile(
  bucket: any,
  storagePath: string,
  userId: string
): Promise<{ safe: boolean; reason?: string; mimeType?: string }> {
  const file = bucket.file(storagePath);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      return { safe: false, reason: 'File does not exist in storage.' };
    }

    const [metadata] = await file.getMetadata();
    const fileSize = Number(metadata.size || 0);

    // Max 5 MB boundary
    if (fileSize <= 0 || fileSize > 5 * 1024 * 1024) {
      await file.delete().catch(() => {});
      return { safe: false, reason: `File size (${fileSize} bytes) exceeds 5 MB limit.` };
    }

    // Read initial 64 KB for magic bytes and active content check
    const [buffer] = await file.download({ start: 0, end: Math.min(fileSize, 64 * 1024) - 1 });
    const validation = validateFileBuffer(buffer);

    if (!validation.isValid) {
      // 🚨 AUTOMATIC QUARANTINE PURGE: Delete malicious or invalid file immediately
      await file.delete().catch(() => {});

      await logSecurityEvent({
        eventType: validation.hasActiveContent || validation.isExecutable ? 'MALICIOUS_FILE_UPLOAD_PURGED' : 'INVALID_FILE_UPLOAD_REJECTED',
        severity: validation.hasActiveContent || validation.isExecutable ? 'CRITICAL' : 'MEDIUM',
        actorUid: userId,
        details: {
          storagePath,
          fileSize,
          rejectionReason: validation.rejectionReason,
          isExecutable: validation.isExecutable || false,
          hasActiveContent: validation.hasActiveContent || false,
        },
      });

      return { safe: false, reason: validation.rejectionReason };
    }

    return { safe: true, mimeType: validation.mimeType };
  } catch (err: any) {
    await file.delete().catch(() => {});
    return { safe: false, reason: `File verification failed: ${err.message}` };
  }
}
