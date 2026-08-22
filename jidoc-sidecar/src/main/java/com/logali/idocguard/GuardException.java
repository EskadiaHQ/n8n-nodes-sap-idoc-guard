package com.logali.idocguard;

final class GuardException extends RuntimeException {
  private final int status;
  private final String code;

  GuardException(int status, String code) {
    super(code);
    this.status = status;
    this.code = code;
  }

  GuardException(int status, String code, Throwable cause) {
    super(code, cause);
    this.status = status;
    this.code = code;
  }

  int status() { return status; }
  String code() { return code; }
}
