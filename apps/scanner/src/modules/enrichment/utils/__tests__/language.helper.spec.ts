/**
 * Unit tests for `resolveOutputLanguage`.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-4-Output-Language-Resolution.
 * Design: `sdd/classifier-and-writer/design` ADR-3.
 */
import { describe, expect, it } from 'vitest';

import { resolveOutputLanguage } from '../language.helper.js';

describe('resolveOutputLanguage', () => {
  // Jurisdiction defaults (no override)
  it('AR with no override → es', () => {
    expect(resolveOutputLanguage('AR', null)).toBe('es');
  });

  it('CL with no override → es', () => {
    expect(resolveOutputLanguage('CL', undefined)).toBe('es');
  });

  it('CO with no override → es', () => {
    expect(resolveOutputLanguage('CO', null)).toBe('es');
  });

  it('PE with no override → es', () => {
    expect(resolveOutputLanguage('PE', null)).toBe('es');
  });

  it('BR with no override → pt', () => {
    expect(resolveOutputLanguage('BR', null)).toBe('pt');
  });

  it('unknown jurisdiction with no override → en (global fallback)', () => {
    expect(resolveOutputLanguage('MX', null)).toBe('en');
    expect(resolveOutputLanguage('US', undefined)).toBe('en');
    expect(resolveOutputLanguage('ZZ', null)).toBe('en');
  });

  // Override wins over jurisdiction default
  it('AR with override "en" → en', () => {
    expect(resolveOutputLanguage('AR', 'en')).toBe('en');
  });

  it('BR with override "es" → es', () => {
    expect(resolveOutputLanguage('BR', 'es')).toBe('es');
  });

  it('AR with override "pt" → pt', () => {
    expect(resolveOutputLanguage('AR', 'pt')).toBe('pt');
  });

  // Case-insensitive jurisdiction
  it('lowercase jurisdiction "ar" → es', () => {
    expect(resolveOutputLanguage('ar', null)).toBe('es');
  });

  it('mixed case "Br" → pt', () => {
    expect(resolveOutputLanguage('Br', null)).toBe('pt');
  });

  // Invalid override → silently ignored, falls through to jurisdiction default
  it('invalid override "fr" with AR → es (jurisdiction default, no crash)', () => {
    expect(resolveOutputLanguage('AR', 'fr')).toBe('es');
  });

  it('invalid override "de" with unknown jurisdiction → en (global fallback)', () => {
    expect(resolveOutputLanguage('MX', 'de')).toBe('en');
  });

  it('empty string override → treated as invalid, falls through', () => {
    expect(resolveOutputLanguage('AR', '')).toBe('es');
  });
});
