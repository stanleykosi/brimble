import { createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { acceptedArchiveExtensions } from '@brimble/contracts';

import { AppError } from './errors.js';

const ignoredArchiveMetadataEntryNames = new Set(['__MACOSX', '.DS_Store']);

export function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function hasAcceptedArchiveExtension(filename: string): boolean {
  return acceptedArchiveExtensions.some((extension) => filename.endsWith(extension));
}

export function resolveSafeArchivePath(root: string, entryPath: string): string {
  const normalized = entryPath.replaceAll('\\', '/');

  if (!normalized || normalized.startsWith('/')) {
    throw new AppError({
      code: 'SOURCE_EXTRACT_FAILED',
      message: `Archive entry "${entryPath}" is not allowed`,
      statusCode: 400
    });
  }

  const finalPath = path.resolve(root, normalized);
  const relative = path.relative(root, finalPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError({
      code: 'SOURCE_EXTRACT_FAILED',
      message: `Archive entry "${entryPath}" escapes the workspace`,
      statusCode: 400
    });
  }

  return finalPath;
}

export async function writeStreamToFile(
  stream: Readable,
  destinationPath: string,
  maxBytes: number
): Promise<number> {
  await mkdir(path.dirname(destinationPath), { recursive: true });

  let bytes = 0;
  stream.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);

    if (bytes > maxBytes) {
      stream.destroy(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: `Archive upload exceeds ${maxBytes} bytes`,
          statusCode: 400,
          details: {
            maxBytes
          }
        })
      );
    }
  });

  await pipeline(stream, createWriteStream(destinationPath));
  return bytes;
}

export async function ensureEmptyDir(directoryPath: string): Promise<void> {
  await rm(directoryPath, { recursive: true, force: true });
  await mkdir(directoryPath, { recursive: true });
}

export async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rename(sourcePath, destinationPath);
}

export async function normalizeExtractedSource(
  extractedRootPath: string,
  destinationRootPath: string
): Promise<void> {
  await ensureEmptyDir(destinationRootPath);
  const topLevelEntries = await readdir(extractedRootPath, { withFileTypes: true });
  const meaningfulEntries = topLevelEntries.filter(
    (entry) => !ignoredArchiveMetadataEntryNames.has(entry.name)
  );

  if (meaningfulEntries.length === 0) {
    throw new AppError({
      code: 'SOURCE_EXTRACT_FAILED',
      message: 'Extracted archive is empty',
      statusCode: 400
    });
  }

  const shouldCollapse =
    meaningfulEntries.length === 1 &&
    meaningfulEntries[0]?.isDirectory() === true &&
    (await stat(path.join(extractedRootPath, meaningfulEntries[0].name))).isDirectory();

  const actualSourceRoot = shouldCollapse
    ? path.join(extractedRootPath, meaningfulEntries[0]!.name)
    : extractedRootPath;

  await cp(actualSourceRoot, destinationRootPath, { recursive: true });

  const normalizedEntries = await readdir(destinationRootPath);
  const meaningfulNormalizedEntries = normalizedEntries.filter(
    (entry) => !ignoredArchiveMetadataEntryNames.has(entry)
  );

  if (meaningfulNormalizedEntries.length === 0) {
    throw new AppError({
      code: 'SOURCE_EXTRACT_FAILED',
      message: 'Normalized source directory is empty',
      statusCode: 400
    });
  }
}
