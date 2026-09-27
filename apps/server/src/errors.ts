// The error shape every route uses, and the shared Fastify error handler.
// See docs/architecture.md section 3 for the wire shape of an error.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/** An error with an HTTP status and a stable, machine-readable code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly issues?: unknown;

  constructor(statusCode: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  issues?: unknown,
) {
  return reply.status(statusCode).send({
    error: { code, message, ...(issues !== undefined ? { issues } : {}) },
  });
}

/** Install the error handler and the 404 handler on the app. Call once, at build time. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return sendError(reply, error.statusCode, error.code, error.message, error.issues);
    }

    if (error instanceof ZodError) {
      return sendError(reply, 400, "INVALID_INPUT", "The request body is not valid.", error.issues);
    }

    // Fastify wraps a body-parse or schema failure with a validation property.
    if ((error as { validation?: unknown }).validation) {
      return sendError(reply, 400, "INVALID_INPUT", "The request body is not valid.");
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many requests. Try again later.");
    }
    if (statusCode === 413) {
      return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    }
    if (statusCode === 415) {
      return sendError(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "The server does not accept this content type.");
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, "INVALID_INPUT", "The request is not valid.");
    }

    request.log.error(error, "An unexpected error happened while handling a request.");
    return sendError(reply, 500, "INTERNAL_ERROR", "Something went wrong on the server.");
  });

  app.setNotFoundHandler((_request, reply) => {
    return sendError(reply, 404, "NOT_FOUND", "This route does not exist.");
  });
}
