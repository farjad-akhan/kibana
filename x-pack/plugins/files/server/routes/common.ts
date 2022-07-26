/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { schema } from '@kbn/config-schema';
import type { ResponseHeaders } from '@kbn/core/server';
import type { File } from '../../common/types';

export function getDownloadHeadersForFile(file: File, fileName?: string): ResponseHeaders {
  return {
    'content-type': file.mimeType ?? 'application/octet-stream',
    // note, this name can be overridden by the client if set via a "download" attribute on the HTML tag.
    'content-disposition': `attachment; filename="${fileName || getDownloadedFileName(file)}"`,
  };
}

export function getDownloadedFileName(file: File): string {
  // When creating a file we also calculate the extension so the `file.extension`
  // check is not really necessary except for type checking.
  if (file.mimeType && file.extension) {
    return `${file.name}.${file.extension}`;
  }
  return file.name;
}

const fileNameRegex = /^["]+$/;
export const fileNameSchema = schema.string({
  maxLength: 256,
  validate: (v) => {
    return fileNameRegex.test(v) ? `File name must not contain any double quotes` : undefined;
  },
});
