Version 2.0.0
=============

- Fixed sslCert and sslPrivKey entries being ignored in the config.
- Changed ssl key creation to be done at startup instead of on npm install.

Breaking Changes
----------------
- Node.js versions below 10 are no longer supported.
