import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HTTP_STATUS, TaskOpError } from '../services/taskService';

// ─────────────────────────────────────────────────────────────────────────────
// Stopping one bad request from taking down the service.
//
// Express 4 does not understand async handlers. When one rejects, nothing
// catches it: the rejection becomes an unhandledRejection, and Node's default
// since v15 is to terminate the process. So a single request — an Admin
// pressing "Remove Member" on somebody who still had a task assigned — killed
// the API for everyone, and Render restarted it.
//
// Two layers here, and both are needed:
//
//   asyncRoute   — forwards a rejected handler into Express's error pipeline
//                  instead of leaving it unhandled.
//   errorHandler — turns whatever arrives there into an honest status code,
//                  so the caller learns what went wrong rather than watching
//                  the connection drop.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap an async route handler so a rejection reaches `errorHandler`.
 *
 * Every route in this codebase is async, so every route needs this. It is
 * applied at the route definitions rather than inside each controller: a
 * controller that forgets a try/catch is normal, and should not be fatal.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Postgres/Prisma failures that describe a situation the caller can act on,
 * rather than a bug. Anything not listed is a 500 and gets logged in full.
 */
function fromPrisma(err: Prisma.PrismaClientKnownRequestError): { status: number; message: string } | null {
  switch (err.code) {
    case 'P2002':
      return { status: 409, message: 'That value is already in use.' };
    case 'P2003':
    case 'P2014':
      return {
        status: 409,
        message: 'This record is still referenced by other data and cannot be removed.',
      };
    case 'P2025':
      return { status: 404, message: 'Not found.' };
    default:
      return null;
  }
}

/**
 * Some connector errors arrive as PrismaClientUnknownRequestError with the
 * Postgres SQLSTATE buried in the message — a foreign-key RESTRICT violation
 * is one of them, which is exactly the case that caused the crash. Matching on
 * the code is ugly but it is the only thing Prisma surfaces here.
 */
function fromPostgresText(message: string): { status: number; message: string } | null {
  if (message.includes('23503') || message.includes('violates RESTRICT setting')) {
    return {
      status: 409,
      message: 'This record is still referenced by other data and cannot be removed.',
    };
  }
  if (message.includes('23505')) {
    return { status: 409, message: 'That value is already in use.' };
  }
  return null;
}

/**
 * The last stop. Must be registered AFTER every route, and must keep all four
 * parameters — Express identifies error middleware by arity, and dropping
 * `_next` silently turns this back into an ordinary handler that never runs.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // A response already started — nothing useful left to say, and writing a
  // second status would throw inside the error handler itself.
  if (res.headersSent) return;

  if (err instanceof TaskOpError) {
    res.status(HTTP_STATUS[err.code]).json({ error: err.message });
    return;
  }

  const mapped =
    (err instanceof Prisma.PrismaClientKnownRequestError ? fromPrisma(err) : null) ??
    fromPostgresText(String((err as Error)?.message ?? ''));

  if (mapped) {
    console.warn(`[API] ${req.method} ${req.originalUrl} → ${mapped.status}: ${mapped.message}`);
    res.status(mapped.status).json({ error: mapped.message });
    return;
  }

  // Genuinely unexpected. Log everything, tell the caller nothing — an internal
  // message could carry a query, a column name, or a value from another record.
  console.error(`[API] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/**
 * Last-resort net for a rejection that escapes the request pipeline entirely —
 * a fire-and-forget `void somePromise()` with no catch, for instance.
 *
 * Deliberately does NOT exit. For a web service, staying up with a logged
 * error beats dropping every in-flight request because one background task
 * failed. The log line is loud so this cannot quietly become normal.
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('🚨 [Process] Unhandled promise rejection — service kept running:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('🚨 [Process] Uncaught exception — service kept running:', err);
  });
}
