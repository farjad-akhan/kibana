/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import fs from 'fs/promises';
import moment from 'moment';
import { existsSync } from 'fs';
import path from 'path';
import { ToolingLog } from '@kbn/tooling-log';
import { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import { ESClient, Document, TransactionDocument } from './es_client';
import { getRequests } from './server_request';
import { fetchRequests, requestsToStreams } from './es_request';

const DATE_FORMAT = `YYYY-MM-DD'T'HH:mm:ss.SSS'Z'`;

interface CLIParams {
  param: {
    journeyName: string;
    scalabilitySetup: ScalabilitySetup;
    buildId: string;
    withoutStaticResources: boolean;
  };
  client: {
    baseURL: string;
    username: string;
    password: string;
  };
  log: ToolingLog;
}

interface InjectionStep {
  action: string;
  minUsersCount?: number;
  maxUsersCount: number;
  duration: string;
}

export interface ScalabilitySetup {
  warmup: InjectionStep[];
  test: InjectionStep[];
  maxDuration: string;
}

const calculateTransactionTimeRage = (hit: SearchHit<Document>) => {
  const trSource = hit._source as Document;
  const startTime = trSource['@timestamp'];
  const duration = trSource.transaction.duration.us / 1000; // convert microseconds to milliseconds
  const endTime = moment(startTime, DATE_FORMAT).add(duration, 'milliseconds').toISOString();
  return { startTime, endTime };
};

const saveFile = async (output: any, outputDir: string, fileName: string, log: ToolingLog) => {
  const filePath = path.resolve(outputDir, fileName);

  if (!existsSync(outputDir)) {
    await fs.mkdir(outputDir, { recursive: true });
  }
  await fs.writeFile(filePath, JSON.stringify(output, null, 2), 'utf8');
  log.info(`Output file saved: ${filePath}`);
};

export const extractor = async ({ param, client, log }: CLIParams) => {
  const authOptions = {
    node: client.baseURL,
    username: client.username,
    password: client.password,
  };
  const { journeyName, scalabilitySetup, buildId, withoutStaticResources } = param;
  log.info(
    `Searching transactions with 'labels.testBuildId=${buildId}' and 'labels.journeyName=${journeyName}'`
  );
  const esClient = new ESClient(authOptions, log);
  const ftrTransactionHits = await esClient.getFtrServiceTransactions(buildId, journeyName);
  if (!ftrTransactionHits || ftrTransactionHits.length === 0) {
    log.warning(
      `No 'functional test runner' transactions found. Can't calculate journey time range, output file won't be generated.`
    );
    return;
  }

  // There should be a single top-level transaction, representing journey browser starting time and session duration.
  if (ftrTransactionHits.length > 1) {
    log.warning(`Filtering doesn't work, more than 1 'functional test runner' transaction found`);
    return;
  }

  const timeRange = calculateTransactionTimeRage(ftrTransactionHits[0]);
  // Filtering out setup/teardown related transactions by time range from 'functional test runner' transaction
  const hits = await esClient.getKibanaServerTransactions(buildId, journeyName, timeRange);
  if (!hits || hits.length === 0) {
    log.warning(`No Kibana server transactions found. Output file won't be generated.`);
    return;
  }

  const source = hits[0]!._source as TransactionDocument;
  const kibanaVersion = source.service.version;

  const kibanaRequests = getRequests(hits, withoutStaticResources, log);
  const esRequests = await fetchRequests(esClient, kibanaRequests);
  log.info(
    `Found ${kibanaRequests.length} Kibana server and ${esRequests.length} Elasticsearch requests`
  );
  const streams = requestsToStreams(esRequests);

  const outputDir = path.resolve('target/scalability_traces');
  const fileName = `${journeyName.replace(/ /g, '')}-${buildId}.json`;

  if (scalabilitySetup) {
    await saveFile(
      {
        journeyName,
        kibanaVersion,
        scalabilitySetup,
        requests: kibanaRequests,
      },
      path.resolve(outputDir, 'server'),
      fileName,
      log
    );
  }

  await saveFile(
    {
      journeyName,
      kibanaVersion,
      streams: Array.from(streams.values()),
    },
    path.resolve(outputDir, 'es'),
    fileName,
    log
  );
};
