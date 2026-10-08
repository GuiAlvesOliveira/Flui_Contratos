import { SetMetadata } from '@nestjs/common';

export const TRACK_USAGE_KEY = 'trackUsage';

export type UsageEventName =
  | 'login'
  | 'process_created'
  | 'stage_changed'
  | 'document_uploaded'
  | 'form_submitted';

export interface TrackUsageMeta {
  name: UsageEventName;
  // Extra dimensions taken from the handler's response (never personal data)
  props?: (response: unknown) => Record<string, string | undefined>;
}

/**
 * VAL-04: marks a route as a usage event. UsageTelemetryInterceptor sends it
 * to Application Insights after the request succeeds.
 */
export const TrackUsage = (
  name: UsageEventName,
  props?: TrackUsageMeta['props'],
) => SetMetadata(TRACK_USAGE_KEY, { name, props } satisfies TrackUsageMeta);
