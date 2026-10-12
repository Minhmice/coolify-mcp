import { z } from 'zod';
import { redactSecrets } from '../coolify/redaction.js';
import { CoolifyError } from '../coolify/errors.js';

export const RESOURCE_UUID_REGEX = /^[A-Za-z0-9_-]+$/;
export const resourceUuidSchema = z.string().min(1).max(128).regex(RESOURCE_UUID_REGEX);

export function assertValidResourceUuid(uuid: unknown): string {
  if (typeof uuid !== 'string' || !RESOURCE_UUID_REGEX.test(uuid)) {
    throw new CoolifyError({
      message: 'Invalid resource identifier format',
      kind: 'validation',
    });
  }
  return uuid;
}

export interface ResourceView {
  uuid: string;
  name?: string;
  status?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  metadata: Record<string, unknown>;
}

export interface TeamView {
  id: number;
  name?: string;
}

export interface OperationResult {
  resourceUuid?: string;
  operationId?: string;
  message?: string;
  status?: string;
}

export interface LogOptions {
  resourceUuid: string;
  includeSensitive?: boolean;
  confirmResourceUuid?: string;
  maxBytes?: number;
}

export interface LogResult {
  resourceUuid: string;
  requiresSensitiveOptIn: boolean;
  text?: string;
  truncated: boolean;
}

export type EnvScope =
  | { kind: 'application' | 'service' | 'database' | 'server' | 'project'; resourceUuid: string }
  | { kind: 'team' };

export interface EnvView {
  uuid?: string;
  id?: number;
  key: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
  value: '[REDACTED]';
}

export interface EnvInput {
  resourceUuid: string;
  envUuid?: string;
  key: string;
  value: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
}

export interface EnvChange {
  key: string;
  scope: string;
  changed: boolean;
}

export function toSnakeCaseRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (output[snakeKey] === undefined) {
      output[snakeKey] = value;
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// Project schemas
// ---------------------------------------------------------------------------
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ---------------------------------------------------------------------------
// Application schemas
// ---------------------------------------------------------------------------
const baseAppFields = {
  project_uuid: z.string().min(1).optional(),
  projectUuid: z.string().min(1).optional(),
  server_uuid: z.string().min(1).optional(),
  serverUuid: z.string().min(1).optional(),
  environment_name: z.string().optional(),
  environmentName: z.string().optional(),
  environment_uuid: z.string().optional(),
  environmentUuid: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  instant_deploy: z.boolean().optional(),
  destination_uuid: z.string().optional(),
  destinationUuid: z.string().optional(),
  is_auto_deploy_enabled: z.boolean().optional(),
  is_force_https_enabled: z.boolean().optional(),
  is_preview_deployments_enabled: z.boolean().optional(),
};

export const createPublicAppSchema = z.object({
  type: z.literal('public'),
  ...baseAppFields,
  git_repository: z.string().min(1).optional(),
  gitRepository: z.string().min(1).optional(),
  git_branch: z.string().min(1).optional(),
  gitBranch: z.string().min(1).optional(),
  build_pack: z.string().optional(),
  buildPack: z.string().optional(),
  ports_exposes: z.string().optional(),
  portsExposes: z.string().optional(),
});

export const createDockerfileAppSchema = z.object({
  type: z.literal('dockerfile'),
  ...baseAppFields,
  dockerfile: z.string().min(1).optional(),
  ports_exposes: z.string().optional(),
  portsExposes: z.string().optional(),
});

export const createDockerImageAppSchema = z.object({
  type: z.literal('dockerimage'),
  ...baseAppFields,
  docker_image: z.string().min(1).optional(),
  dockerImage: z.string().min(1).optional(),
  image: z.string().min(1).optional(),
  ports_exposes: z.string().optional(),
  portsExposes: z.string().optional(),
});

export const createPrivateGithubAppSchema = z.object({
  type: z.literal('private-github-app'),
  ...baseAppFields,
  github_app_uuid: z.string().min(1).optional(),
  githubAppUuid: z.string().min(1).optional(),
  git_repository: z.string().min(1).optional(),
  gitRepository: z.string().min(1).optional(),
  git_branch: z.string().min(1).optional(),
  gitBranch: z.string().min(1).optional(),
  build_pack: z.string().optional(),
  buildPack: z.string().optional(),
  ports_exposes: z.string().optional(),
  portsExposes: z.string().optional(),
});

export const createPrivateDeployKeyAppSchema = z.object({
  type: z.literal('private-deploy-key'),
  ...baseAppFields,
  private_key_uuid: z.string().min(1).optional(),
  privateKeyUuid: z.string().min(1).optional(),
  git_repository: z.string().min(1).optional(),
  gitRepository: z.string().min(1).optional(),
  git_branch: z.string().min(1).optional(),
  gitBranch: z.string().min(1).optional(),
  build_pack: z.string().optional(),
  buildPack: z.string().optional(),
  ports_exposes: z.string().optional(),
  portsExposes: z.string().optional(),
});

export const createApplicationSchema = z.discriminatedUnion('type', [
  createPublicAppSchema,
  createDockerfileAppSchema,
  createDockerImageAppSchema,
  createPrivateGithubAppSchema,
  createPrivateDeployKeyAppSchema,
]);
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  fqdn: z.string().optional(),
  domains: z.string().optional(),
  build_pack: z.string().optional(),
  git_branch: z.string().optional(),
  git_repository: z.string().optional(),
  ports_exposes: z.string().optional(),
  install_command: z.string().optional(),
  build_command: z.string().optional(),
  start_command: z.string().optional(),
  base_directory: z.string().optional(),
  publish_directory: z.string().optional(),
  dockerfile: z.string().optional(),
  docker_compose_location: z.string().optional(),
  docker_compose_raw: z.string().optional(),
  is_auto_deploy_enabled: z.boolean().optional(),
  is_force_https_enabled: z.boolean().optional(),
  is_preview_deployments_enabled: z.boolean().optional(),
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

// ---------------------------------------------------------------------------
// Service schemas
// ---------------------------------------------------------------------------
export const createServiceSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  project_uuid: z.string().min(1).optional(),
  projectUuid: z.string().min(1).optional(),
  server_uuid: z.string().min(1).optional(),
  serverUuid: z.string().min(1).optional(),
  environment_name: z.string().optional(),
  environmentName: z.string().optional(),
  environment_uuid: z.string().optional(),
  environmentUuid: z.string().optional(),
  destination_uuid: z.string().optional(),
  destinationUuid: z.string().optional(),
  instant_deploy: z.boolean().optional(),
  docker_compose_raw: z.string().optional(),
  dockerComposeRaw: z.string().optional(),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  docker_compose_raw: z.string().optional(),
  dockerComposeRaw: z.string().optional(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

// ---------------------------------------------------------------------------
// Database schemas
// ---------------------------------------------------------------------------
const baseDbFields = {
  server_uuid: z.string().min(1).optional(),
  serverUuid: z.string().min(1).optional(),
  project_uuid: z.string().min(1).optional(),
  projectUuid: z.string().min(1).optional(),
  environment_name: z.string().optional(),
  environmentName: z.string().optional(),
  environment_uuid: z.string().optional(),
  environmentUuid: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  is_public: z.boolean().optional(),
  public_port: z.number().optional(),
  destination_uuid: z.string().optional(),
  destinationUuid: z.string().optional(),
  instant_deploy: z.boolean().optional(),
};

export const createPostgreSqlSchema = z.object({
  type: z.literal('postgresql'),
  ...baseDbFields,
  postgres_user: z.string().optional(),
  postgres_password: z.string().optional(),
  postgres_db: z.string().optional(),
  postgres_initdb_args: z.string().optional(),
  postgres_host_auth_method: z.string().optional(),
  postgres_conf: z.string().optional(),
});

export const createMySqlSchema = z.object({
  type: z.literal('mysql'),
  ...baseDbFields,
  mysql_user: z.string().optional(),
  mysql_password: z.string().optional(),
  mysql_root_password: z.string().optional(),
  mysql_database: z.string().optional(),
  mysql_conf: z.string().optional(),
});

export const createMariaDbSchema = z.object({
  type: z.literal('mariadb'),
  ...baseDbFields,
  mariadb_user: z.string().optional(),
  mariadb_password: z.string().optional(),
  mariadb_root_password: z.string().optional(),
  mariadb_database: z.string().optional(),
  mariadb_conf: z.string().optional(),
});

export const createMongoDbSchema = z.object({
  type: z.literal('mongodb'),
  ...baseDbFields,
  mongo_initdb_root_username: z.string().optional(),
  mongo_initdb_root_password: z.string().optional(),
  mongo_initdb_database: z.string().optional(),
  mongo_conf: z.string().optional(),
});

export const createRedisSchema = z.object({
  type: z.literal('redis'),
  ...baseDbFields,
  redis_password: z.string().optional(),
  redis_conf: z.string().optional(),
});

export const createClickHouseSchema = z.object({
  type: z.literal('clickhouse'),
  ...baseDbFields,
  clickhouse_admin_user: z.string().optional(),
  clickhouse_admin_password: z.string().optional(),
});

export const createDragonflySchema = z.object({
  type: z.literal('dragonfly'),
  ...baseDbFields,
  dragonfly_password: z.string().optional(),
});

export const createKeyDbSchema = z.object({
  type: z.literal('keydb'),
  ...baseDbFields,
  keydb_password: z.string().optional(),
  keydb_conf: z.string().optional(),
});

export const createSqliteSchema = z.object({
  type: z.literal('sqlite'),
  ...baseDbFields,
});

export const createDatabaseSchema = z.discriminatedUnion('type', [
  createPostgreSqlSchema,
  createMySqlSchema,
  createMariaDbSchema,
  createMongoDbSchema,
  createRedisSchema,
  createClickHouseSchema,
  createDragonflySchema,
  createKeyDbSchema,
  createSqliteSchema,
]);
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

export const updateDatabaseSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  is_public: z.boolean().optional(),
  public_port: z.number().optional(),
});
export type UpdateDatabaseInput = z.infer<typeof updateDatabaseSchema>;

// ---------------------------------------------------------------------------
// Deploy application input
// ---------------------------------------------------------------------------
export const deployApplicationSchema = z.object({
  resourceUuid: resourceUuidSchema,
  force: z.boolean().optional(),
});
export type DeployApplicationInput = z.infer<typeof deployApplicationSchema>;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------
export function normalizeResource(raw: unknown): ResourceView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CoolifyError({
      message: 'Invalid resource payload: expected an object',
      kind: 'validation',
    });
  }

  const obj = raw as Record<string, unknown>;
  const rawUuid = obj.uuid ?? obj.id;
  if (typeof rawUuid !== 'string' || !RESOURCE_UUID_REGEX.test(rawUuid)) {
    throw new CoolifyError({
      message: 'Invalid resource identifier in payload',
      kind: 'validation',
    });
  }

  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const createdAt =
    typeof obj.created_at === 'string' || typeof obj.created_at === 'number'
      ? obj.created_at
      : typeof obj.createdAt === 'string' || typeof obj.createdAt === 'number'
        ? obj.createdAt
        : undefined;
  const updatedAt =
    typeof obj.updated_at === 'string' || typeof obj.updated_at === 'number'
      ? obj.updated_at
      : typeof obj.updatedAt === 'string' || typeof obj.updatedAt === 'number'
        ? obj.updatedAt
        : undefined;

  const metadata = (redactSecrets(obj) as Record<string, unknown>) ?? {};

  return {
    uuid: rawUuid,
    name,
    status,
    createdAt,
    updatedAt,
    metadata,
  };
}

export function normalizeTeam(raw: unknown): TeamView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CoolifyError({
      message: 'Invalid team payload: expected an object',
      kind: 'validation',
    });
  }

  const obj = raw as Record<string, unknown>;
  const parsedId = typeof obj.id === 'number' ? obj.id : Number.parseInt(String(obj.id), 10);
  if (Number.isNaN(parsedId)) {
    throw new CoolifyError({
      message: 'Invalid team id in payload',
      kind: 'validation',
    });
  }

  return {
    id: parsedId,
    name: typeof obj.name === 'string' ? obj.name : undefined,
  };
}

export function normalizeOperation(raw: unknown): OperationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.deployments) && obj.deployments.length > 0) {
    const first = obj.deployments[0];
    if (typeof first === 'object' && first !== null) {
      const dep = first as Record<string, unknown>;
      return {
        resourceUuid:
          typeof dep.resource_uuid === 'string'
            ? dep.resource_uuid
            : typeof dep.resourceUuid === 'string'
              ? dep.resourceUuid
              : typeof dep.uuid === 'string'
                ? dep.uuid
                : undefined,
        operationId:
          typeof dep.deployment_uuid === 'string'
            ? dep.deployment_uuid
            : typeof dep.deploymentUuid === 'string'
              ? dep.deploymentUuid
              : typeof dep.operation_id === 'string'
                ? dep.operation_id
                : typeof dep.operationId === 'string'
                  ? dep.operationId
                  : undefined,
        message: typeof dep.message === 'string' ? dep.message : undefined,
        status: typeof dep.status === 'string' ? dep.status : undefined,
      };
    }
  }

  return {
    resourceUuid:
      typeof obj.resourceUuid === 'string'
        ? obj.resourceUuid
        : typeof obj.resource_uuid === 'string'
          ? obj.resource_uuid
          : typeof obj.uuid === 'string'
            ? obj.uuid
            : undefined,
    operationId:
      typeof obj.operationId === 'string'
        ? obj.operationId
        : typeof obj.operation_id === 'string'
          ? obj.operation_id
          : typeof obj.deployment_uuid === 'string'
            ? obj.deployment_uuid
            : typeof obj.deploymentUuid === 'string'
              ? obj.deploymentUuid
              : typeof obj.id === 'string' || typeof obj.id === 'number'
                ? String(obj.id)
                : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
    status: typeof obj.status === 'string' ? obj.status : undefined,
  };
}
