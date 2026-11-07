# Registered account OTP localized provider messages

## Stage 1 — strict private templates

The pure `renderAccountOtpMessage` formatter renders Kazakh and Russian sign-in/sign-up email and SMS templates for `AccountOtpDeliveryPort` implementations. Email has a localized subject; SMS has no subject and stays under 160 characters. The code is a six-digit string, including leading zeros; the expiry must match the existing five-minute challenge TTL. The text tells users not to share the code.

## Stage 2 — provider-safe boundaries

The formatter accepts only internal `AccountOtpDispatchMessage`, strictly validates locale, purpose, channel, code, five-minute expiry and the destination's length/control-character boundary. It returns only `channel`, `destination`, `subject` and `text`; no challenge ID, user identity or provider metadata. The output is sensitive, must not be logged or exposed via API.

This is a **preparation utility**, not a delivery provider. No provider is registered, no real SMS/email is sent, and public account signup/login endpoints remain disabled. When integrating a vetted provider, it must call this formatter inside the private adapter, enforce recipient normalization and transport idempotency/network timeouts, and keep all outbound traffic subject to reviewed Kazakhstan privacy and data residency requirements.

## Stage 3 — tests and release gates

Unit tests cover kk/ru email and SMS for both purposes, code with leading zeros, fixed TTL, bounded SMS text, secret/reference non-leakage, and invalid/control-character input rejection. Do not consider OTP production-ready until the delivery vendor, secure contact enrollment, abuse budgets, trusted network attestation and end-to-end login/cookie workflow are approved.
