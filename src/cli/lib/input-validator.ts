/**
 * Tolerant input validation helpers for bounty-task publish.
 *
 * v0.7 narrows client-side hard validation to the truly required fields and
 * converts type mismatches into friendly usage errors instead of TypeError.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: string };

export interface NormalizedPublishInput {
  title: string;
  type: string;
  reward: number;
  description?: string;
  descriptionFile?: string;
  tags?: string[];
  deadline?: number;
  idempotencyKey?: string;
  publisherAddress?: string;
  publisherId?: string;
}

function got(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return String(value);
}

function validateRequiredString(
  opts: Record<string, unknown>,
  key: string,
  flag: string
): ValidationResult<string> {
  const value = opts[key];
  if (value === undefined || value === null) {
    return { ok: false, field: key, error: `✗ ${flag} is required` };
  }
  if (typeof value !== 'string') {
    return { ok: false, field: key, error: `✗ ${flag} must be a string (got ${got(value)})` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, field: key, error: `✗ ${flag} cannot be empty` };
  }
  return { ok: true, value: trimmed };
}

function validateOptionalString(
  opts: Record<string, unknown>,
  key: string,
  flag: string
): ValidationResult<string | undefined> {
  const value = opts[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return { ok: false, field: key, error: `✗ ${flag} must be a string (got ${got(value)})` };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed || undefined };
}

function validateReward(value: unknown): ValidationResult<number> {
  if (value === undefined || value === null || value === '') {
    return { ok: false, field: 'reward', error: '✗ --reward is required' };
  }

  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;

  if (!Number.isFinite(numeric)) {
    return { ok: false, field: 'reward', error: `✗ --reward must be a number (got ${got(value)})` };
  }
  if (numeric <= 0) {
    return { ok: false, field: 'reward', error: '✗ --reward must be a positive number' };
  }
  return { ok: true, value: numeric };
}

function validateTags(value: unknown): ValidationResult<string[] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return { ok: false, field: 'tags', error: `✗ --tags must be a comma-separated string (got ${got(value)})` };
  }
  if (!value.trim()) {
    return { ok: false, field: 'tags', error: '✗ --tags requires a value (got nothing)' };
  }
  const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
  if (tags.length === 0) {
    return { ok: false, field: 'tags', error: '✗ --tags requires a value (got nothing)' };
  }
  return { ok: true, value: tags };
}

function validateDeadline(value: unknown): ValidationResult<number | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (value === '') {
    return { ok: false, field: 'deadline', error: '✗ --deadline requires a value (got nothing)' };
  }
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(numeric)) {
    return { ok: false, field: 'deadline', error: `✗ --deadline must be a numeric timestamp (got ${got(value)})` };
  }
  return { ok: true, value: numeric };
}

export function validatePublishInput(
  opts: Record<string, unknown>
): ValidationResult<NormalizedPublishInput> {
  const title = validateRequiredString(opts, 'title', '--title');
  if (!title.ok) return title;

  const type = validateRequiredString(opts, 'type', '--type');
  if (!type.ok) return type;

  const reward = validateReward(opts.reward);
  if (!reward.ok) return reward;

  const description = validateOptionalString(opts, 'description', '--description');
  if (!description.ok) return description;

  const descriptionFile = validateOptionalString(opts, 'description-file', '--description-file');
  if (!descriptionFile.ok) return descriptionFile;

  const tags = validateTags(opts.tags);
  if (!tags.ok) return tags;

  const deadline = validateDeadline(opts.deadline);
  if (!deadline.ok) return deadline;

  const idempotencyKey = validateOptionalString(opts, 'idempotency-key', '--idempotency-key');
  if (!idempotencyKey.ok) return idempotencyKey;

  const publisherAddress = validateOptionalString(opts, 'publisher-address', '--publisher-address');
  if (!publisherAddress.ok) return publisherAddress;

  const publisherId = validateOptionalString(opts, 'publisher-id', '--publisher-id');
  if (!publisherId.ok) return publisherId;

  return {
    ok: true,
    value: {
      title: title.value,
      type: type.value,
      reward: reward.value,
      description: description.value,
      descriptionFile: descriptionFile.value,
      tags: tags.value,
      deadline: deadline.value,
      idempotencyKey: idempotencyKey.value,
      publisherAddress: publisherAddress.value,
      publisherId: publisherId.value,
    },
  };
}
