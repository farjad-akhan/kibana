/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'assert';
import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import type { BlobStorage } from '../../types';
import type { ReadableContentStream } from './content_stream';
import { getReadableContentStream, getWritableContentStream } from './content_stream';
import { mappings } from './mappings';

/**
 * Export this value for convenience to be used in tests. Do not use outside of
 * this adapter.
 * @internal
 */
export const BLOB_STORAGE_SYSTEM_INDEX_NAME = '.kibana_blob_storage';

export const MAX_BLOB_STORE_SIZE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB

export class ElasticsearchBlobStorage implements BlobStorage {
  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly index: string = BLOB_STORAGE_SYSTEM_INDEX_NAME,
    private readonly chunkSize: undefined | string,
    private readonly logger: Logger
  ) {
    assert(
      this.index.startsWith('.kibana'),
      `Elasticsearch blob store index name must start with ".kibana", got ${this.index}.`
    );
  }

  /**
   * @note
   * There is a known issue where calling this function simultaneously can result
   * in a race condition where one of the calls will fail because the index is already
   * being created.
   *
   * This is only an issue for the very first time the index is being created.
   */
  private async createIndexIfNotExists(): Promise<void> {
    const index = this.index;
    if (await this.esClient.indices.exists({ index })) {
      this.logger.debug(`${index} already exists.`);
      return;
    }

    this.logger.info(`Creating ${index} for Elasticsearch blob store.`);

    try {
      await this.esClient.indices.create({
        index,
        body: {
          settings: {
            number_of_shards: 1,
            // TODO: Find out whether this is an appropriate setting
            auto_expand_replicas: '0-1',
          },
          mappings,
        },
      });
    } catch (e) {
      if (e instanceof errors.ResponseError && e.statusCode === 400) {
        this.logger.warn('Unable to create blob storage index, it may have been created already.');
      }
      throw e;
    }
  }

  public async upload(
    src: Readable,
    { transforms, id }: { transforms?: Transform[]; id?: string } = {}
  ): Promise<{ id: string; size: number }> {
    await this.createIndexIfNotExists();

    try {
      const dest = getWritableContentStream({
        id,
        client: this.esClient,
        index: this.index,
        logger: this.logger.get('content-stream-upload'),
        parameters: {
          maxChunkSize: this.chunkSize,
        },
      });
      await pipeline.apply(null, [src, ...(transforms ?? []), dest] as unknown as Parameters<
        typeof pipeline
      >);

      return {
        id: dest.getContentReferenceId()!,
        size: dest.getBytesWritten(),
      };
    } catch (e) {
      this.logger.error(`Could not write chunks to Elasticsearch: ${e}`);
      throw e;
    }
  }

  private getReadableContentStream(id: string, size?: number): ReadableContentStream {
    return getReadableContentStream({
      id,
      client: this.esClient,
      index: this.index,
      logger: this.logger.get('content-stream-download'),
      parameters: {
        size,
      },
    });
  }

  public async download({ id, size }: { id: string; size?: number }): Promise<Readable> {
    return this.getReadableContentStream(id, size);
  }

  public async delete(id: string): Promise<void> {
    try {
      const dest = getWritableContentStream({
        id,
        client: this.esClient,
        index: this.index,
        logger: this.logger.get('content-stream-delete'),
      });
      /** @note Overwriting existing content with an empty buffer to remove all the chunks. */
      await promisify(dest.end.bind(dest, '', 'utf8'))();
    } catch (e) {
      this.logger.error(`Could not delete file: ${e}`);
      throw e;
    }
  }
}
