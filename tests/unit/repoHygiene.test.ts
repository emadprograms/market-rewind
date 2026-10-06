/**
 * Repository hygiene guards (Phase 42, LAKE-VERIFY-02).
 *
 * These tests exist because this class of defect already broke the suite once:
 * 50 of 80 Vitest files failed to load in CI/other checkouts because one file
 * imported modules through absolute paths from a developer's machine, and the
 * React Testing Library peer dependency was missing from package.json.
 *
 * They are cheap read-only checks over the working tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCANNED_DIRS = ['tests', 'src'];
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'playwright-report', 'test-results']);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Absolute machine paths: POSIX home dirs, macOS user dirs, Windows drive letters. */
const ABSOLUTE_PATH_PATTERN =
  /(from|import|vi\.mock|require)\s*\(?\s*['"](?:\/(?:Users|home)\/[^'"]*|[A-Za-z]:\\[^'"]*)['"]/;

describe('repository hygiene', () => {
  const files = SCANNED_DIRS.flatMap((dir) => collectFiles(join(REPO_ROOT, dir)));

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('contains no absolute machine paths in import or mock specifiers', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      contents.split('\n').forEach((line, index) => {
        if (ABSOLUTE_PATH_PATTERN.test(line)) {
          offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('declares the React Testing Library DOM peer explicitly in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.devDependencies).toBeTruthy();
    expect(pkg.devDependencies['@testing-library/dom']).toBeTruthy();
  });

  it('keeps a committed .npmrc so npm install works without ad-hoc flags', () => {
    const npmrc = readFileSync(join(REPO_ROOT, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/legacy-peer-deps\s*=\s*true/);
  });
});
