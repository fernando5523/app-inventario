/**
 * Errores de dominio comunes a todos los modulos. error.middleware.ts los
 * traduce a la respuesta HTTP correspondiente; los service.ts los lanzan.
 */

export class ErrorHttp extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NoEncontrado extends ErrorHttp {
  constructor(message = 'No encontrado.') {
    super(404, message);
  }
}

export class SolicitudInvalida extends ErrorHttp {
  constructor(message = 'Solicitud invalida.') {
    super(400, message);
  }
}

export class NoAutorizado extends ErrorHttp {
  constructor(message = 'No autorizado.') {
    super(401, message);
  }
}

/** Token valido pero sin permiso para la accion (rol insuficiente/fuera de alcance). */
export class Prohibido extends ErrorHttp {
  constructor(message = 'No tenes permiso para esta accion.') {
    super(403, message);
  }
}

export class Conflicto extends ErrorHttp {
  constructor(message = 'La solicitud entra en conflicto con el estado actual.') {
    super(409, message);
  }
}

export class DemasiadosIntentos extends ErrorHttp {
  constructor(message = 'Demasiados intentos. Volve a intentar mas tarde.') {
    super(429, message);
  }
}
