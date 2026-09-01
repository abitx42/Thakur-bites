enum UpdateStatus {
  upToDate,
  updateAvailable,
  forceUpdateRequired,
}

class AppVersionPolicy {
  final String latestVersion;
  final String minimumSupportedVersion;
  final bool forceUpdate;
  final String message;
  final List<String> releaseNotes;
  final String storeUrl;
  final DateTime? updatedAt;

  const AppVersionPolicy({
    required this.latestVersion,
    required this.minimumSupportedVersion,
    this.forceUpdate = false,
    this.message = 'A new version of Thakur Bites is available.',
    this.releaseNotes = const [],
    this.storeUrl = '',
    this.updatedAt,
  });

  factory AppVersionPolicy.fromMap(Map<String, dynamic> data) {
    List<String> notes = [];
    if (data['releaseNotes'] is List) {
      notes = (data['releaseNotes'] as List).map((e) => e.toString()).toList();
    }

    DateTime? updated;
    if (data['updatedAt'] != null) {
      try {
        if (data['updatedAt'] is DateTime) {
          updated = data['updatedAt'] as DateTime;
        } else if (data['updatedAt'].toDate != null) {
          updated = data['updatedAt'].toDate();
        }
      } catch (_) {
        updated = null;
      }
    }

    return AppVersionPolicy(
      latestVersion: data['latestVersion'] as String? ?? '1.0.0',
      minimumSupportedVersion: data['minimumSupportedVersion'] as String? ?? '1.0.0',
      forceUpdate: data['forceUpdate'] as bool? ?? false,
      message: data['message'] as String? ?? 'A new version of Thakur Bites is available.',
      releaseNotes: notes,
      storeUrl: data['storeUrl'] as String? ?? '',
      updatedAt: updated,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'latestVersion': latestVersion,
      'minimumSupportedVersion': minimumSupportedVersion,
      'forceUpdate': forceUpdate,
      'message': message,
      'releaseNotes': releaseNotes,
      'storeUrl': storeUrl,
      'updatedAt': updatedAt?.toIso8601String(),
    };
  }

  /// Evaluates update status given the currently installed client version string.
  UpdateStatus evaluate(String installedVersion) {
    if (forceUpdate) {
      return UpdateStatus.forceUpdateRequired;
    }

    // If installed version is less than minimum supported -> Force Update
    if (compareSemver(installedVersion, minimumSupportedVersion) < 0) {
      return UpdateStatus.forceUpdateRequired;
    }

    // If installed version is less than latest version -> Soft Update Available
    if (compareSemver(installedVersion, latestVersion) < 0) {
      return UpdateStatus.updateAvailable;
    }

    return UpdateStatus.upToDate;
  }

  /// Semantic Versioning comparator.
  /// Returns:
  ///   < 0 if v1 < v2
  ///   0 if v1 == v2
  ///   > 0 if v1 > v2
  static int compareSemver(String v1, String v2) {
    final cleanV1 = _sanitizeVersion(v1);
    final cleanV2 = _sanitizeVersion(v2);

    final parts1 = cleanV1.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    final parts2 = cleanV2.split('.').map((e) => int.tryParse(e) ?? 0).toList();

    while (parts1.length < 3) {
      parts1.add(0);
    }
    while (parts2.length < 3) {
      parts2.add(0);
    }

    for (int i = 0; i < 3; i++) {
      if (parts1[i] < parts2[i]) return -1;
      if (parts1[i] > parts2[i]) return 1;
    }

    return 0;
  }

  static String _sanitizeVersion(String v) {
    // Remove build number suffix like '+1' or '-beta'
    String clean = v.trim();
    if (clean.contains('+')) {
      clean = clean.split('+').first;
    }
    if (clean.contains('-')) {
      clean = clean.split('-').first;
    }
    return clean;
  }
}
