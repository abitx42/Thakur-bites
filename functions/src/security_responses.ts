export interface SecuritySanitizedResponse {
  success: boolean;
  error: string;
  message: string;
  incidentId: string;
}

/**
 * Standardized Non-Oracle Defense Response Generator.
 * Returns a uniform, non-revealing error payload with a correlation incidentId.
 * Never leaks internal WAF rules, SQL/NoSQL schema names, regex patterns, or rate-limit thresholds.
 */
export function createSecuritySanitizedResponse(incidentId: string, customMessage?: string): SecuritySanitizedResponse {
  return {
    success: false,
    error: 'REQUEST_REJECTED',
    message: customMessage || 'Nice try. Try harder. 😉',
    incidentId: incidentId.replace('INCIDENT-', ''),
  };
}
