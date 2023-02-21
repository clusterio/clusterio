# Setting up TLS

By default Clusterio will listen for connections over HTTP which is fine for local networks but over the Internet it should idealy be over HTTPS as there are some credentials that could be exposed to eavesdroppers.
The recommended setup is to have an ordinary HTTPS server software like Apache or Nginx to act as a reverse proxy in front of the Clusterio controller.
The reverse proxy would then be set up with a TLS certificate from a Certificate Authoritiy like [Let's Encrypt](https://letsencrypt.org).
Alternatively you can have Clusterio listen for connections over HTTPS directly by providing it with a TLS certificate and private key.

Note that a TLS certificate signed by a recognized Certificate Authority in general requires that you own a domain.
See the last section for how to create and use a self-signed certificate for an IP address if you don't have a domain.


## Using a reverse proxy

Configure the proxy to forward requests over HTTP to the port the controller is listening to so that for example a request to `https://example.com/instances/` is forwarded to `http://localhost:8080/instances/`.
It is possible to host the interface under a sub-path, in that case a request under the sub-path should be mapped to the controller with the sub-path stripped out.
For example `https://example.com/sub/path/instances/` would be mapped to `http://localhost:8080/instances`.

Additianlly WebSocket connections to `/api/socket` also needs to be forwarded.
Typically this requires explicit configuration and support for forwarding WebSocket connections.
If the interface hosted under a sub-path the `/api/socket` address is relative to the sub-path and the sub-path also needs to be stripped out when forwarded.

You can also optionally set the controller to listen only on the loopback interface to prevent it being directly connected to from the outside.

    npx clusteriocontroller config set controller.bind_address 127.0.0.1


### Apache Config

To proxy with Apache make sure that `proxy_module`, `proxy_http_module` and `proxy_wstunnel_module` is loaded in the config, then add the following directives to wherever is the approriate place for your flavour of Apache config organization.

```apache
<Location /sub/path/>
    ProxyPass "http://localhost:8080/"
</location>
<Location /sub/path/api/socket>
    ProxyPass "ws://localhost:8080/api/socket"
</Location>
```

Replace `/sub/path/` with the location on the proxy you want to host the Clusterio interface under.
If the whole domain is to be dedicated to the Clusterio interface then `/sub/path/` should be just `/`.
Pay attention to the use of trailing slashes, as they are important.


## Hosting HTTPS directly from Node.js

Listening on HTTPS is supported by the Clusterio controller via the `controller.https_port` option provided paths to a certificate file and a private key file is configured for the `controller.tls_certificate` and `controller.tls_private_key` options.
Both of these are expected to be unencrypted PEM files.


## Creating and using a self-signed certificate

Create a self-signed certificate with OpenSSL by running

    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -subj /CN=localhost -addext "subjectAltName=IP:<ip>"

substituting `<ip>` with the IP address the server will be accessed under, for example `IP:203.0.113.4`.
Multiple addresses can be given by supplying a comma sepparated list of `IP:address` pairs and DNS names can also be specified using the `DNS:example.com` format.
You need to supply every name you want to connect to the server under the subjectAltName field, for example to connect to the HTTPS port locally via an address like `https://localhost:4443/` you need to add `DNS:localhost`.

This creates a private key file named `key.pem` and a public certificate file named `cert.pem` and these are used for the `controller.tls_certificate` and `controller.tls_private_key` config options respectively on the controller:

    npx clusteriocontroller config set controller.tls_certificate cert.pem
    npx clusteriocontroller config set controller.tls_private_key key.pem

Additionally you will need copy the `cert.pem` file to all of the computers you want to set up as slaves and configure it as the `slave.tls_ca` option:

    npx clusterioslave config set slave.tls_ca cert.pem

You will also need to copy the `cert.pem` file to all of the computers you want to remotely manage the cluster via clusterctl and configure it as `control.tls_ca` option:

    npx clusterioctl control-config set control.tls_ca cert.pem
