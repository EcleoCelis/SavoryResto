"""Generate self-signed TLS certificates for the SavoryBites staging Nginx proxy.

Creates:
- nginx/certs/staging.crt
- nginx/certs/staging.key
"""

import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path
import sys


def generate_staging_certs(output_dir: Path, *, days: int = 365, force: bool = False) -> tuple[Path, Path]:
    """Generate an RSA 2048 self-signed X.509 certificate with staging SANs."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError as exc:
        raise SystemExit(
            "[-] The 'cryptography' package is required (use backend/.venv python or run openssl directly)."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    cert_path = output_dir / "staging.crt"
    key_path = output_dir / "staging.key"

    if (cert_path.exists() or key_path.exists()) and not force:
        print(f"[*] Existing staging TLS certificates found at {output_dir}; pass --force to overwrite.")
        return cert_path, key_path

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "PH"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SavoryBites Staging"),
            x509.NameAttribute(NameOID.COMMON_NAME, "staging.savorybites.local"),
        ]
    )

    now = datetime.now(timezone.utc)
    san = x509.SubjectAlternativeName(
        [
            x509.DNSName("staging.savorybites.local"),
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]
    )

    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=days))
        .add_extension(san, critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key=private_key, algorithm=hashes.SHA256())
    )

    key_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    cert_bytes = certificate.public_bytes(serialization.Encoding.PEM)

    key_path.write_bytes(key_bytes)
    try:
        key_path.chmod(0o600)
    except OSError:
        pass
    cert_path.write_bytes(cert_bytes)

    print(f"[+] Generated staging TLS certificate: {cert_path}")
    print(f"[+] Generated staging TLS private key: {key_path}")
    return cert_path, key_path


def main() -> int:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Generate self-signed TLS certs for Nginx staging.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "nginx" / "certs",
        help="Directory to write staging.crt and staging.key",
    )
    parser.add_argument("--days", type=int, default=365, help="Validity period in days")
    parser.add_argument("--force", action="store_true", help="Overwrite existing certificate files")
    args = parser.parse_args()

    generate_staging_certs(args.output_dir, days=args.days, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
