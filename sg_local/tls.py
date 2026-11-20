"""TLS settings for every secure connection Stillgreen makes.

Every HTTPS request and every WSS connection to Slack uses
``create_ssl_context()``. The context always checks the certificate and the
host name. There is no switch to turn that off, on purpose.

Where the certificates come from:

1. Your computer's own trust store, through the ``truststore`` package
   (Python 3.10 or newer). On macOS this is the Keychain, so a company
   certificate that IT installed is trusted, the same way Safari and Chrome
   trust it.
2. Without ``truststore`` (for example Python 3.9), Python's default
   certificates, plus, on macOS, Apple's built-in root certificates and the
   certificates an administrator marked as trusted for secure connections
   ("Always Trust"). A certificate that only sits in the System keychain, or
   that is marked "Never Trust", is not used. Login-keychain certificates
   need Python 3.10 or newer (``truststore``).
3. In both cases, extra certificate files named by ``SSL_CERT_FILE``,
   ``SSL_CERT_DIR`` or ``REQUESTS_CA_BUNDLE`` are added.

Adding certificates never removes the normal checks; it only adds more
certificates Stillgreen is willing to trust.
"""

from __future__ import annotations

import functools
import hashlib
import os
import plistlib
import ssl
import subprocess
import sys
import tempfile
import warnings
from typing import Any

SECURITY = "/usr/bin/security"
# Apple's built-in root certificates.
SYSTEM_ROOTS_KEYCHAIN = "/System/Library/Keychains/SystemRootCertificates.keychain"
# Certificates an administrator (or a company device-management profile)
# installed for all users. Only the ones with admin trust settings that say
# "trust for secure connections" are used.
ADMIN_KEYCHAIN = "/Library/Keychains/System.keychain"
MACOS_KEYCHAINS = (SYSTEM_ROOTS_KEYCHAIN, ADMIN_KEYCHAIN)

# Trust settings (see Apple's SecTrustSettings.h).
_TRUST_ROOT, _TRUST_AS_ROOT, _DENY = 1, 2, 3
# Policies that cover a TLS server check: SSL and basic X.509.
_SSL_POLICY_OIDS = {"1.2.840.113635.100.1.3", "1.2.840.113635.100.1.2"}
_SSL_POLICY_NAMES = {"sslserver", "ssl", "basicx509"}


def _on_macos() -> bool:
    return sys.platform == "darwin"


def _truststore() -> Any:
    try:
        import truststore
    except ImportError:
        return None
    return truststore


def extra_ca_locations() -> tuple[list[str], list[str]]:
    """Certificate files and folders named by the usual environment variables."""
    files: list[str] = []
    dirs: list[str] = []
    for name in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
        path = (os.environ.get(name) or "").strip()
        if path and os.path.isfile(path) and path not in files:
            files.append(path)
    cert_dir = (os.environ.get("SSL_CERT_DIR") or "").strip()
    for path in cert_dir.split(os.pathsep) if cert_dir else []:
        if path and os.path.isdir(path) and path not in dirs:
            dirs.append(path)
    return files, dirs


def _pem_blocks(pem: str) -> list[str]:
    marker = "-----END CERTIFICATE-----"
    blocks = []
    for block in pem.split(marker):
        start = block.find("-----BEGIN CERTIFICATE-----")
        if start >= 0:
            blocks.append(block[start:] + marker + "\n")
    return blocks


def _sha1(block: str) -> str:
    try:
        der = ssl.PEM_cert_to_DER_cert(block)
    except (ValueError, TypeError):
        return ""
    return hashlib.sha1(der).hexdigest().upper()  # noqa: S324 - Apple's key for trust settings


def _keychain_certificates(keychain: str) -> list[str]:
    """Every certificate in one keychain, as PEM blocks."""
    if not os.path.exists(keychain):
        return []
    try:
        result = subprocess.run(
            [SECURITY, "find-certificate", "-a", "-p", keychain],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return _pem_blocks(result.stdout)


def _oid_text(der: bytes) -> str:
    """A DER-encoded object identifier (without its tag) as dotted text."""
    if not der:
        return ""
    parts = [str(min(der[0] // 40, 2)), str(der[0] - 40 * min(der[0] // 40, 2))]
    value = 0
    for byte in der[1:]:
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(str(value))
            value = 0
    return ".".join(parts)


def _covers_ssl(entry: dict[str, Any]) -> bool:
    """Does one trust-settings entry apply to checking a TLS server?"""
    policy = entry.get("kSecTrustSettingsPolicy")
    name = str(entry.get("kSecTrustSettingsPolicyName") or "").replace(" ", "").lower()
    if policy is None and not name:
        return True  # no policy named: it applies to every use
    if isinstance(policy, (bytes, bytearray)):
        data = bytes(policy)
        if data[:1] == b"\x06" and len(data) > 2:
            data = data[2:]  # with its DER tag and length
        if _oid_text(data) in _SSL_POLICY_OIDS:
            return True
    return name in _SSL_POLICY_NAMES


def _trust_decision(settings: Any) -> str | None:
    """"trust", "deny" or None (no opinion) for one certificate's settings."""
    if not isinstance(settings, list):
        return None
    if not settings:
        return "trust"  # an empty list means "Always Trust" for everything
    decision = None
    for entry in settings:
        if not isinstance(entry, dict) or not _covers_ssl(entry):
            continue
        result = entry.get("kSecTrustSettingsResult", _TRUST_ROOT)
        if result == _DENY:
            return "deny"
        if result in (_TRUST_ROOT, _TRUST_AS_ROOT):
            decision = "trust"
    return decision


def _trust_settings(domain_flag: str) -> dict[str, str]:
    """SHA-1 -> "trust"/"deny" from ``security trust-settings-export``.

    ``domain_flag`` is "-d" (admin) or "-s" (system). Returns {} when there
    are none, or when they cannot be read.
    """
    with tempfile.TemporaryDirectory(prefix="stillgreen-trust-") as folder:
        target = os.path.join(folder, "trust.plist")
        try:
            subprocess.run(
                [SECURITY, "trust-settings-export", domain_flag, target],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            with open(target, "rb") as handle:
                payload = plistlib.load(handle)
        except (OSError, subprocess.SubprocessError, ValueError, plistlib.InvalidFileException):
            return {}
    decisions: dict[str, str] = {}
    trust_list = payload.get("trustList") if isinstance(payload, dict) else None
    for key, item in (trust_list or {}).items():
        if not isinstance(item, dict):
            continue
        decision = _trust_decision(item.get("trustSettings"))
        if decision:
            decisions[str(key).upper()] = decision
    return decisions


@functools.lru_cache(maxsize=1)
def _macos_keychain_pem() -> str:
    """PEM text of the macOS certificates Stillgreen trusts without truststore.

    Apple's built-in roots (minus any marked "Never Trust"), plus the
    certificates in the System keychain that an administrator marked as
    trusted for secure connections. Read once per process, and each
    certificate is checked once, so a new connection loads one ready blob.
    """
    if not _on_macos():
        return ""
    admin = _trust_settings("-d")
    system = _trust_settings("-s")
    chosen: list[str] = []
    seen: set[str] = set()
    for block in _keychain_certificates(SYSTEM_ROOTS_KEYCHAIN):
        digest = _sha1(block)
        if not digest or digest in seen or "deny" in (admin.get(digest), system.get(digest)):
            continue
        seen.add(digest)
        chosen.append(block)
    if any(decision == "trust" for decision in admin.values()):
        for block in _keychain_certificates(ADMIN_KEYCHAIN):
            digest = _sha1(block)
            if digest and digest not in seen and admin.get(digest) == "trust":
                seen.add(digest)
                chosen.append(block)
    return _usable("".join(chosen))


def _usable(pem: str) -> str:
    """Only the certificates OpenSSL can read, joined, so one load call works."""
    checker = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    good: list[str] = []
    for block in _pem_blocks(pem):
        try:
            checker.load_verify_locations(cadata=block)
        except (ssl.SSLError, ValueError):
            continue
        good.append(block)
    return "".join(good)


def _add_certificates(context: ssl.SSLContext, pem: str) -> None:
    """Add PEM certificates; any that cannot be read are skipped."""
    if not pem:
        return
    try:
        context.load_verify_locations(cadata=pem)
    except (ssl.SSLError, ValueError):
        for block in _pem_blocks(pem):
            try:
                context.load_verify_locations(cadata=block)
            except (ssl.SSLError, ValueError):
                continue


def _load_extra(context: ssl.SSLContext) -> None:
    files, dirs = extra_ca_locations()
    for path in files:
        try:
            context.load_verify_locations(cafile=path)
        except (OSError, ssl.SSLError):
            pass
    for path in dirs:
        try:
            context.load_verify_locations(capath=path)
        except (OSError, ssl.SSLError):
            pass


def _require_verification(context: ssl.SSLContext) -> ssl.SSLContext:
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    try:
        context.minimum_version = ssl.TLSVersion.TLSv1_2
    except (AttributeError, ValueError):
        # Very old OpenSSL or LibreSSL cannot set a minimum version; turn the
        # old versions off one by one instead.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            context.options |= (
                getattr(ssl, "OP_NO_SSLv2", 0)
                | getattr(ssl, "OP_NO_SSLv3", 0)
                | getattr(ssl, "OP_NO_TLSv1", 0)
                | getattr(ssl, "OP_NO_TLSv1_1", 0)
            )
    return context


def create_ssl_context() -> ssl.SSLContext:
    """A client TLS context that always checks certificates and host names."""
    truststore = _truststore()
    if truststore is not None:
        context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    else:
        # Loads Python's default certificates; OpenSSL also reads
        # SSL_CERT_FILE and SSL_CERT_DIR here.
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
        pem = _macos_keychain_pem()
        if pem:
            _add_certificates(context, pem)
    _load_extra(context)
    return _require_verification(context)


def trust_source() -> dict[str, Any]:
    """Where certificates come from, in words a person can read.

    For the diagnostics page and ``sg-local doctor``. Contains paths only,
    never certificate contents.
    """
    files, dirs = extra_ca_locations()
    if _truststore() is not None:
        source = "system"
        label = "Your computer's trusted certificates"
    elif _on_macos():
        source = "python+keychain"
        label = "Python's certificates, Apple's root certificates and the ones your administrator trusts"
    else:
        source = "python"
        label = "Python's built-in certificate list"
    return {
        "source": source,
        "label": label,
        "truststore": source == "system",
        "extra_files": files,
        "extra_dirs": dirs,
    }
