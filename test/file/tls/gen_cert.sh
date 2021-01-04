#!/usr/bin/bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -nodes -out cert.pem -days 3650 -subj /CN=localhost -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
