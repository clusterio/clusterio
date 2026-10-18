# Migrating Plugins to 2.1

This guide covers the changes needed to bring a plugin written for 2.0 up to 2.1.
Plugins still on an alpha should start with the [2.0 guide](plugin-migration-to-2.0.md).


## Request errors

`RequestError` is gone.
Errors thrown by request handlers are now received by the requester as the same class, see [Request errors](/docs/writing-plugins.md#request-errors).
Replace `RequestError` with the class that fits:

- Invalid input: `ValidationError`.
- Operation disabled by config: `ForbiddenError`.
- Missing instance, user, save etc.: `NotFoundError`.
- Instance running, name taken etc.: `ConflictError`.
- Host not connected, instance not running: `UnavailableError`.
- Timeouts: `TimeoutError`.

`catch` blocks that check `err instanceof RequestError` should check `ClientError` instead, or the specific class.
Checks of `err.code` for remote errors can use `instanceof`, e.g. `err instanceof lib.SessionLost`.

The config errors `lib.InvalidValue`, `lib.InvalidField` and `lib.InvalidAccess` were renamed to `lib.InvalidValueError`, `lib.InvalidFieldError` and `lib.InvalidAccessError`.

Errors of classes that are not registered, like a `TypeError` from a bug, are received as `InternalServerError`.
Plugins that define their own error classes need to list them in `errors` of the plugin declaration.
