# Freedoom Phase 1 v0.13.0

Official release: https://github.com/freedoom/freedoom/releases/tag/v0.13.0

Archive: https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip

- ZIP: 24,143,781 bytes; SHA-256 `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`.
- Member: `freedoom-0.13.0/freedoom1.wad`.
- Original WAD: 28,795,076 bytes; SHA-256 `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`.
- Tracked `freedoom1.wad.gz`: 10,304,935 bytes; SHA-256 `49837dd8f11d558bc26a48a50a653fcd3168e7f18c1c385057053c53282599ff`.
- Compression: `gzip -n -6 -c freedoom1.wad > freedoom1.wad.gz`, Apple gzip 479. `-n` suppresses original filename/timestamp. Repeated compression produced identical bytes; decompression reproduced the original WAD size and hash.

Acquired over HTTPS from the official tagged archive on 2026-10-17, following
GitHub's normal redirect to release-assets.githubusercontent.com. Archive members
were enumerated before extracting the single WAD. The retained temporary ZIP,
WAD and gzip were independently rehashed before reuse for this implementation.
The ZIP and uncompressed WAD are not repository assets. Builds never download or
recompress Freedoom.

`COPYING.txt`, `CREDITS.txt`, and `CREDITS-MUSIC.txt` are copied byte-for-byte from
the same verified ZIP's `freedoom-0.13.0/` directory (including BOM/line endings).
The BSD 3-Clause notice includes copyright, conditions and warranty disclaimer.
The shared reviewed byte identities are in `app/src/freedoom-identity.json`.
The static staging verifier publishes the three texts under `notices/freedoom/`.
Freedoom and its contributors do not endorse Doom Decisions.

This asset's provenance does not resolve the engine's separate GPL corresponding
source/build obligations or the existing vendored example asset questions.
