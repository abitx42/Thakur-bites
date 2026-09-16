package com.thakurbites.thakur_bites

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.view.WindowManager
import android.view.View
import java.io.File
import java.security.MessageDigest

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.thakurbites.security/device_integrity"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Screen capture defense & recents snapshot protection
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        // Tapjacking & Obscuring Floating Window (Cloak & Dagger) Defense
        try {
            window.decorView.filterTouchesWhenObscured = true
        } catch (_: Exception) {}

        // Android 12+ (API 31+) Overlay Window Concealment (Hides all non-system overlay windows)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                window.setHideOverlayWindows(true)
            } catch (_: Exception) {}
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getDeviceSecurityPosture" -> {
                    try {
                        val posture = inspectDevicePosture()
                        result.success(posture)
                    } catch (e: Exception) {
                        result.error("INTEGRITY_CHECK_FAILED", e.message, null)
                    }
                }
                "openDeveloperSettings" -> {
                    try {
                        val intent = Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        startActivity(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        try {
                            val generalIntent = Intent(Settings.ACTION_SETTINGS)
                            generalIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            startActivity(generalIntent)
                            result.success(true)
                        } catch (err: Exception) {
                            result.error("SETTINGS_OPEN_FAILED", err.message, null)
                        }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun inspectDevicePosture(): Map<String, Any> {
        val cr = contentResolver

        val isDevOptionsEnabled = try {
            Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0
        } catch (_: Exception) {
            false
        }

        val isAdbEnabled = try {
            Settings.Secure.getInt(cr, Settings.Secure.ADB_ENABLED, 0) != 0
        } catch (_: Exception) {
            false
        }

        val isRooted = checkRoot()
        val isHooked = checkFridaAndHooking()
        val isDebuggerAttached = checkDebugger()
        val isClonedOrSandboxed = checkClonedOrSandboxed()
        val isEmulator = checkEmulator()
        val signatureHash = getApkSignatureHash()
        val deviceId = getAnonymousDeviceId()

        return mapOf(
            "isDevOptionsEnabled" to isDevOptionsEnabled,
            "isAdbEnabled" to isAdbEnabled,
            "isRooted" to isRooted,
            "isHooked" to isHooked,
            "isDebuggerAttached" to isDebuggerAttached,
            "isClonedOrSandboxed" to isClonedOrSandboxed,
            "isEmulator" to isEmulator,
            "signatureHash" to signatureHash,
            "deviceId" to deviceId,
            "osVersion" to (Build.VERSION.RELEASE ?: "UNKNOWN"),
            "apiLevel" to Build.VERSION.SDK_INT
        )
    }

    private fun checkRoot(): Boolean {
        // 1. Build tags check
        val buildTags = Build.TAGS
        if (buildTags != null && buildTags.contains("test-keys")) return true

        // 2. SU & Magisk filesystem checks
        val paths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su",
            "/sbin/.magisk",
            "/data/adb/magisk",
            "/data/adb/ksu",
            "/data/adb/modules",
            "/system/bin/.ext/.su",
            "/system/xbin/daemonsu",
            "/dev/com.koushikdutta.superuser.daemon/"
        )
        for (path in paths) {
            if (File(path).exists()) return true
        }

        // 3. Which SU runtime check
        val hasSuProcess = try {
            val process = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
            process.inputStream.bufferedReader().use { it.readLine() != null }
        } catch (_: Exception) {
            false
        }
        if (hasSuProcess) return true

        // 4. Mounts inspection for Magisk / KernelSU / Zygisk overlays
        try {
            val mounts = File("/proc/mounts")
            if (mounts.exists()) {
                mounts.bufferedReader().useLines { lines ->
                    for (l in lines) {
                        val low = l.lowercase()
                        if (low.contains("magisk") || low.contains("core/mirror") || low.contains("core/img") || low.contains("ksu")) {
                            return true
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 5. SELinux Enforcing Status Check (detects Permissive or Disabled SELinux common in custom rooted ROMs)
        if (checkSelinuxPermissive()) return true

        return false
    }

    private fun checkSelinuxPermissive(): Boolean {
        return try {
            val process = Runtime.getRuntime().exec("getenforce")
            process.inputStream.bufferedReader().use { reader ->
                val status = reader.readLine()?.trim()?.lowercase()
                status == "permissive" || status == "disabled"
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun checkFridaAndHooking(): Boolean {
        // 1. Memory map inspection for injected hooking libraries & RWX dynamic memory
        try {
            val mapsFile = File("/proc/self/maps")
            if (mapsFile.exists()) {
                mapsFile.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        val lower = line.lowercase()
                        if (lower.contains("frida-agent") || lower.contains("gadget.so") || 
                            lower.contains("libxposed") || lower.contains("libsubstrate") ||
                            lower.contains("libmembi") || lower.contains("frida-gadget")) {
                            return true
                        }
                        // RWX segments violate Android W^X policy and indicate injected shellcode or Frida stubs
                        val tokens = line.trim().split("\\s+".toRegex())
                        if (tokens.size >= 2) {
                            val perms = tokens[1]
                            if (perms.contains("r") && perms.contains("w") && perms.contains("x")) {
                                return true
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 2. File traces of Frida server
        val fridaPaths = arrayOf(
            "/data/local/tmp/frida-server",
            "/data/local/tmp/re.frida.server",
            "/data/local/tmp/frida"
        )
        for (p in fridaPaths) {
            if (File(p).exists()) return true
        }

        // 3. Socket connectivity probe to default Frida server ports 27042 and 27043
        for (port in arrayOf(27042, 27043)) {
            try {
                val socket = java.net.Socket()
                socket.connect(java.net.InetSocketAddress("127.0.0.1", port), 150)
                socket.close()
                return true
            } catch (_: Exception) {}
        }

        // 4. Kernel socket table inspection (/proc/net/tcp and /proc/net/tcp6 for 0x69A2 / 0x69A3)
        try {
            for (procPath in arrayOf("/proc/net/tcp", "/proc/net/tcp6")) {
                val tcpFile = File(procPath)
                if (tcpFile.exists()) {
                    tcpFile.bufferedReader().useLines { lines ->
                        for (line in lines) {
                            val parts = line.trim().split("\\s+".toRegex())
                            if (parts.size >= 2) {
                                val localAddress = parts[1]
                                if (localAddress.endsWith(":69A2") || localAddress.endsWith(":69A3")) {
                                    return true
                                }
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 5. Frida dynamic thread inspection
        try {
            val taskDir = File("/proc/self/task")
            if (taskDir.exists() && taskDir.isDirectory) {
                taskDir.listFiles()?.forEach { task ->
                    val commFile = File(task, "comm")
                    if (commFile.exists()) {
                        val name = commFile.readText().trim().lowercase()
                        if (name.contains("frida") || name.contains("gmain") || name.contains("gum-js-loop")) {
                            return true
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        return false
    }

    private fun checkDebugger(): Boolean {
        try {
            // 1. Android JDWP Debugger Check
            if (android.os.Debug.isDebuggerConnected() || android.os.Debug.waitingForDebugger()) {
                return true
            }

            // 2. Linux Kernel Native TracerPid Inspection (/proc/self/status)
            // When native debuggers (gdb, lldb, IDA Pro) or Frida native ptrace engine attach, TracerPid is non-zero
            val statusFile = File("/proc/self/status")
            if (statusFile.exists()) {
                statusFile.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        if (line.startsWith("TracerPid:")) {
                            val parts = line.split(":")
                            if (parts.size >= 2) {
                                val tracerPid = parts[1].trim().toIntOrNull() ?: 0
                                if (tracerPid != 0) {
                                    return true
                                }
                            }
                            break
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        return false
    }

    private fun checkClonedOrSandboxed(): Boolean {
        try {
            // 0. Process UID vs Package ApplicationInfo UID Integrity Check
            // Dual-space containers run isolated apps under their host UID, causing a process/package UID mismatch
            val myUid = Process.myUid()
            val appUid = applicationInfo.uid
            if (myUid != appUid) {
                return true
            }

            // 1. Filesystem Directory Namespace Integrity
            // Genuine paths: /data/user/0/com.thakurbites.thakur_bites/files or /data/data/com.thakurbites.thakur_bites/files
            val filesPath = applicationContext.filesDir.absolutePath
            val lowerPath = filesPath.lowercase()
            val clonerMarkers = arrayOf(
                "com.lbe.parallel", "parallel", "dualspace", "virtualapp", "cloneapp",
                "multiapp", "dualsplit", "multiaccount", "vapp", "sandbox"
            )
            for (marker in clonerMarkers) {
                if (lowerPath.contains(marker) && !lowerPath.contains("com.thakurbites.thakur_bites")) {
                    return true
                }
            }
            if (!filesPath.contains(packageName)) {
                return true
            }

            // 2. Package Manager Audit for Known Cheat Tools & Cloner Engines
            val pm = packageManager
            val suspectPackages = arrayOf(
                "com.chelpus.lackypatch",
                "com.dimonvideo.luckypatcher",
                "com.android.vending.billing.InAppBillingService.LUCK",
                "catch_.me_.if_.you_.can_",
                "com.lbe.parallel.intl",
                "com.lbe.parallel",
                "com.excelliance.dualsplit",
                "com.polestar.super.clone",
                "com.dualspace.multispace.android",
                "com.applisto.appcloner"
            )
            for (pkg in suspectPackages) {
                try {
                    pm.getPackageInfo(pkg, 0)
                    return true
                } catch (_: PackageManager.NameNotFoundException) {}
            }

            // 3. Xposed / LSPosed / Substrate Dynamic Classloader Inspection
            try {
                ClassLoader.getSystemClassLoader().loadClass("de.robv.android.xposed.XposedBridge")
                return true
            } catch (_: Throwable) {}

            try {
                ClassLoader.getSystemClassLoader().loadClass("io.github.lsposed.lspd.core.Startup")
                return true
            } catch (_: Throwable) {}

            try {
                val vxp = System.getProperty("vxp")
                if (vxp != null && vxp.isNotEmpty()) return true
            } catch (_: Throwable) {}
        } catch (_: Exception) {}

        return false
    }

    private fun checkEmulator(): Boolean {
        return try {
            (Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || Build.MODEL.contains("google_sdk")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK built for x86")
                || Build.MANUFACTURER.contains("Genymotion")
                || Build.HARDWARE.contains("goldfish")
                || Build.HARDWARE.contains("ranchu"))
        } catch (_: Exception) {
            false
        }
    }

    private fun getApkSignatureHash(): String {
        return try {
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val packageInfo = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                packageInfo.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                val packageInfo = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                packageInfo.signatures
            }

            if (signatures != null && signatures.isNotEmpty()) {
                val certBytes = signatures[0].toByteArray()
                val md = MessageDigest.getInstance("SHA-256")
                val digest = md.digest(certBytes)
                digest.joinToString("") { "%02x".format(it) }
            } else {
                "UNKNOWN_SIGNATURE"
            }
        } catch (e: Exception) {
            "SIG_ERROR: ${e.message}"
        }
    }

    private fun getAnonymousDeviceId(): String {
        return try {
            val rawId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "UNKNOWN_DEVICE"
            val md = MessageDigest.getInstance("SHA-256")
            val digest = md.digest(rawId.toByteArray(Charsets.UTF_8))
            digest.joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            "ANON_DEVICE_ID"
        }
    }
}
