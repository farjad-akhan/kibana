/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';

// eslint-disable-next-line @kbn/imports/no_boundary_crossing
import { mockTimelineData } from '../../../../common/mock/mock_timeline_data';
import { createGenericAuditRowRenderer } from '../../timeline/body/renderers/auditd/generic_row_renderer';
import { CONNECTED_USING } from '../../timeline/body/renderers/auditd/translations';
import { ROW_RENDERER_BROWSER_EXAMPLE_TIMELINE_ID } from '../constants';

const AuditdExampleComponent: React.FC = () => {
  const auditdRowRenderer = createGenericAuditRowRenderer({
    actionName: 'connected-to',
    text: CONNECTED_USING,
  });

  return (
    <>
      {auditdRowRenderer.renderRow({
        data: mockTimelineData[26].ecs,
        isDraggable: false,
        timelineId: ROW_RENDERER_BROWSER_EXAMPLE_TIMELINE_ID,
      })}
    </>
  );
};
export const AuditdExample = React.memo(AuditdExampleComponent);
