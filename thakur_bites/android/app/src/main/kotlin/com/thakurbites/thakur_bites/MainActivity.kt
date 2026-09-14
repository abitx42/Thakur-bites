package com.thakurbites.thakur_bites

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.thakurbites.security/device_integrity"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

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

        val isRooted = checkRootMethod1() || checkRootMethod2() || checkRootMethod3()
        val signatureHash = getApkSignatureHash()
        val deviceId = getAnonymousDeviceId()

        return mapOf(
            "isDevOptionsEnabled" to isDevOptionsEnabled,
            "isAdbEnabled" to isAdbEnabled,
            "isRooted" to isRooted,
            "signatureHash" to signatureHash,
            "deviceId" to deviceId,
            "osVersion" to (Build.VERSION.RELEASE ?: "UNKNOWN"),
            "apiLevel" to Build.VERSION.SDK_INT
        )
    }

    private fun checkRootMethod1(): Boolean {
        val buildTags = Build.TAGS
        return buildTags != null && buildTags.contains("test-keys")
    }

    private fun checkRootMethod2(): Boolean {
        val paths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su"
        )
        for (path in paths) {
            if (File(path).exists()) return true
        }
        return false
    }

    private fun checkRootMethod3(): Boolean {
        return try {
            val process = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
            process.inputStream.bufferedReader().use { it.readLine() != null }
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
