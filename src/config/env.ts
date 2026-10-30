/**
 * Runtime configuration. Comes from .env.local in development and from the
 * hosting provider's environment variables in production.
 */
import { validateEnv } from './validate-env';

export const readEnv = () => validateEnv(import.meta.env);
