import { z } from 'zod';

export const profileNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/, 'Profile name must match /^[a-z0-9_-]+$/ (lowercase letters, digits, dash, underscore)');

export const bountyAuthSchema = z.object({
  type: z.literal('jwt'),
  access_token: z.string().optional(),
  refresh_token: z.string().nullable().optional(),
  expires_at: z.number().int().positive().optional(),
  scope: z.array(z.string()).optional(),
});

export const bountyProfileSchema = z.object({
  name: profileNameSchema,
  description: z.string().max(500).optional(),
  api_base: z.string().url().refine((url) => /^https?:\/\//.test(url), {
    message: 'api_base must start with http:// or https://',
  }),
  ws_base: z.string().url().optional(),
  agent_id: z.string().uuid().optional(),
  agent_address: z.string().optional(),
  email: z.string().email().optional(),
  auth: bountyAuthSchema,
  tls_verify: z.boolean().optional(),
  default_scope: z.array(z.string()).optional(),
  created_at: z.number().int().positive(),
  updated_at: z.number().int().positive(),
  last_used_at: z.number().int().positive().optional(),
});

export const bountyGlobalConfigSchema = z.object({
  version: z.literal(1),
  active_profile: profileNameSchema,
  schema_version: z.string().min(1),
});

export type BountyProfileInput = z.infer<typeof bountyProfileSchema>;
export type BountyGlobalConfigInput = z.infer<typeof bountyGlobalConfigSchema>;
