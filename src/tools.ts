import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { CoolifyClient } from './coolify/client.js';
import { CoolifyError } from './coolify/errors.js';
import { redactSecrets } from './coolify/redaction.js';
import { assertDeleteConfirmation } from './policy.js';
import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  restartApplication,
  stopApplication,
  updateApplication,
} from './resources/applications.js';
import {
  createDatabase,
  deleteDatabase,
  getDatabase,
  listDatabases,
  restartDatabase,
  startDatabase,
  stopDatabase,
  updateDatabase,
} from './resources/databases.js';
import {
  cancelDeployment,
  deployApplication,
  getDeployment,
  listDeployments,
} from './resources/deployments.js';
import {
  deleteApplicationEnvironmentVariable,
  getEnvironmentVariable,
  listEnvironmentVariables,
  setApplicationEnvironmentVariable,
} from './resources/environment.js';
import { getApplicationLogs, getDeploymentLogs } from './resources/logs.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from './resources/projects.js';
import { deleteServer, getServer, listServers } from './resources/servers.js';
import {
  createService,
  deleteService,
  getService,
  listServices,
  restartService,
  startService,
  stopService,
  updateService,
} from './resources/services.js';
import { getCurrentTeam, listTeams } from './resources/teams.js';
import type {
  CreateApplicationInput,
  CreateDatabaseInput,
  EnvScope,
} from './resources/types.js';

function createToolWrapper(config: AppConfig) {
  return function wrapHandler<A, T>(
    fn: (args: A) => Promise<T>,
    getSecretValues?: (args: A) => string[],
  ) {
    return async (args: A) => {
      try {
        const result = await fn(args);
        const secretValues = getSecretValues ? getSecretValues(args) : [];
        const redacted = redactSecrets(result, [config.token, ...secretValues]);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(redacted ?? null, null, 2) }],
        };
      } catch (err: unknown) {
        if (err instanceof CoolifyError) {
          const payload: Record<string, unknown> = {
            message: err.message,
            kind: err.kind,
            retryable: err.retryable,
          };
          if (err.status !== undefined) payload.status = err.status;
          if (err.retryAfter !== undefined) payload.retryAfter = err.retryAfter;
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          };
        }
        const message = err instanceof Error ? err.message : 'Tool execution failed';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    };
  };
}

export function registerTools(
  server: McpServer,
  client: CoolifyClient,
  config: AppConfig,
): void {
  const wrapHandler = createToolWrapper(config);
  // ==========================================
  // READ TOOLS (18)
  // ==========================================

  server.tool(
    'coolify_get_current_team',
    'Get current team authenticated by the API token',
    {},
    wrapHandler(() => getCurrentTeam(client)),
  );

  server.tool(
    'coolify_list_teams',
    'List teams accessible by the API token',
    {},
    wrapHandler(() => listTeams(client)),
  );

  server.tool(
    'coolify_list_projects',
    'List projects in Coolify',
    {},
    wrapHandler(() => listProjects(client)),
  );

  server.tool(
    'coolify_get_project',
    'Get details of a specific project by UUID',
    { resourceUuid: z.string().describe('Project UUID') },
    wrapHandler(async ({ resourceUuid }) => getProject(client, resourceUuid)),
  );

  server.tool(
    'coolify_list_applications',
    'List applications in Coolify',
    {},
    wrapHandler(() => listApplications(client)),
  );

  server.tool(
    'coolify_get_application',
    'Get details of an application by UUID',
    { resourceUuid: z.string().describe('Application UUID') },
    wrapHandler(async ({ resourceUuid }) => getApplication(client, resourceUuid)),
  );

  server.tool(
    'coolify_list_services',
    'List services in Coolify',
    {},
    wrapHandler(() => listServices(client)),
  );

  server.tool(
    'coolify_get_service',
    'Get details of a service by UUID',
    { resourceUuid: z.string().describe('Service UUID') },
    wrapHandler(async ({ resourceUuid }) => getService(client, resourceUuid)),
  );

  server.tool(
    'coolify_list_databases',
    'List databases in Coolify',
    {},
    wrapHandler(() => listDatabases(client)),
  );

  server.tool(
    'coolify_get_database',
    'Get details of a database by UUID',
    { resourceUuid: z.string().describe('Database UUID') },
    wrapHandler(async ({ resourceUuid }) => getDatabase(client, resourceUuid)),
  );

  server.tool(
    'coolify_list_servers',
    'List managed servers in Coolify',
    {},
    wrapHandler(() => listServers(client)),
  );

  server.tool(
    'coolify_get_server',
    'Get details of a server by UUID',
    { resourceUuid: z.string().describe('Server UUID') },
    wrapHandler(async ({ resourceUuid }) => getServer(client, resourceUuid)),
  );

  server.tool(
    'coolify_list_deployments',
    'List deployments in Coolify',
    {},
    wrapHandler(() => listDeployments(client)),
  );

  server.tool(
    'coolify_get_deployment',
    'Get details of a deployment by UUID',
    { resourceUuid: z.string().describe('Deployment UUID') },
    wrapHandler(async ({ resourceUuid }) => getDeployment(client, resourceUuid)),
  );

  server.tool(
    'coolify_get_application_logs',
    'Get logs of an application. Returns metadata by default; requires includeSensitive: true and matching confirmResourceUuid to view log text.',
    {
      resourceUuid: z.string().describe('Application UUID'),
      includeSensitive: z.boolean().optional().describe('Opt-in to sensitive log content'),
      confirmResourceUuid: z.string().optional().describe('Must match resourceUuid when includeSensitive is true'),
    },
    wrapHandler(async ({ resourceUuid, includeSensitive, confirmResourceUuid }) =>
      getApplicationLogs(client, config, { resourceUuid, includeSensitive, confirmResourceUuid }),
    ),
  );

  server.tool(
    'coolify_get_deployment_logs',
    'Get build/deployment logs. Returns metadata by default; requires includeSensitive: true and matching confirmResourceUuid to view log text.',
    {
      resourceUuid: z.string().describe('Deployment UUID'),
      includeSensitive: z.boolean().optional().describe('Opt-in to sensitive log content'),
      confirmResourceUuid: z.string().optional().describe('Must match resourceUuid when includeSensitive is true'),
    },
    wrapHandler(async ({ resourceUuid, includeSensitive, confirmResourceUuid }) =>
      getDeploymentLogs(client, config, { resourceUuid, includeSensitive, confirmResourceUuid }),
    ),
  );

  server.tool(
    'coolify_list_environment_variables',
    'List environment variables for a resource (values are redacted)',
    {
      kind: z.enum(['application', 'service', 'database', 'server', 'project', 'team']),
      resourceUuid: z.string().optional().describe('Resource UUID (required for non-team scopes)'),
    },
    wrapHandler(async ({ kind, resourceUuid }) => {
      let scope: EnvScope;
      if (kind === 'team') {
        scope = { kind: 'team' };
      } else {
        if (!resourceUuid) {
          throw new Error(`resourceUuid is required for scope kind "${kind}"`);
        }
        scope = { kind, resourceUuid };
      }
      return listEnvironmentVariables(client, scope);
    }),
  );

  server.tool(
    'coolify_get_environment_variable',
    'Get an environment variable by UUID (value is redacted)',
    {
      kind: z.enum(['application', 'service', 'database', 'server', 'project', 'team']),
      resourceUuid: z.string().optional().describe('Resource UUID (required for non-team scopes)'),
      envUuid: z.string().describe('Environment variable UUID'),
    },
    wrapHandler(async ({ kind, resourceUuid, envUuid }) => {
      let scope: EnvScope;
      if (kind === 'team') {
        scope = { kind: 'team' };
      } else {
        if (!resourceUuid) {
          throw new Error(`resourceUuid is required for scope kind "${kind}"`);
        }
        scope = { kind, resourceUuid };
      }
      return getEnvironmentVariable(client, scope, envUuid);
    }),
  );

  // ==========================================
  // OPERATIONAL TOOLS (10)
  // ==========================================

  server.tool(
    'coolify_deploy_application',
    'Deploy an application by UUID',
    {
      resourceUuid: z.string().describe('Application UUID'),
      force: z.boolean().optional().describe('Force deployment without cache'),
    },
    wrapHandler(async ({ resourceUuid, force }) => deployApplication(client, { resourceUuid, force })),
  );

  server.tool(
    'coolify_restart_application',
    'Restart an application by UUID',
    { resourceUuid: z.string().describe('Application UUID') },
    wrapHandler(async ({ resourceUuid }) => restartApplication(client, resourceUuid)),
  );

  server.tool(
    'coolify_stop_application',
    'Stops an application. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Application UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm stopping'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) => {
      assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
      return stopApplication(client, resourceUuid);
    }),
  );

  server.tool(
    'coolify_cancel_deployment',
    'Cancels an active deployment. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Deployment UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm cancellation'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) => {
      assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
      return cancelDeployment(client, resourceUuid);
    }),
  );

  server.tool(
    'coolify_start_service',
    'Start a service stack by UUID',
    { resourceUuid: z.string().describe('Service UUID') },
    wrapHandler(async ({ resourceUuid }) => startService(client, resourceUuid)),
  );

  server.tool(
    'coolify_stop_service',
    'Stops a service stack. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Service UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm stopping'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) => {
      assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
      return stopService(client, resourceUuid);
    }),
  );

  server.tool(
    'coolify_restart_service',
    'Restart a service stack by UUID',
    { resourceUuid: z.string().describe('Service UUID') },
    wrapHandler(async ({ resourceUuid }) => restartService(client, resourceUuid)),
  );

  server.tool(
    'coolify_start_database',
    'Start a database by UUID',
    { resourceUuid: z.string().describe('Database UUID') },
    wrapHandler(async ({ resourceUuid }) => startDatabase(client, resourceUuid)),
  );

  server.tool(
    'coolify_stop_database',
    'Stops a database. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Database UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm stopping'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) => {
      assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
      return stopDatabase(client, resourceUuid);
    }),
  );

  server.tool(
    'coolify_restart_database',
    'Restart a database by UUID',
    { resourceUuid: z.string().describe('Database UUID') },
    wrapHandler(async ({ resourceUuid }) => restartDatabase(client, resourceUuid)),
  );

  // ==========================================
  // CONFIGURATION TOOLS (5)
  // ==========================================

  server.tool(
    'coolify_set_application_environment_variable',
    'Set or create an environment variable for an application',
    {
      resourceUuid: z.string().describe('Application UUID'),
      key: z.string().describe('Environment variable key'),
      value: z.string().describe('Environment variable value'),
      envUuid: z.string().optional().describe('Environment variable UUID (if updating existing)'),
      isPreview: z.boolean().optional(),
      isLiteral: z.boolean().optional(),
      isMultiline: z.boolean().optional(),
    },
    wrapHandler(
      async (args) => setApplicationEnvironmentVariable(client, args),
      (args) => [args.value],
    ),
  );

  server.tool(
    'coolify_delete_application_environment_variable',
    'Deletes an environment variable from an application. Requires confirmation with matching confirmResourceUuid and confirmEnvUuid.',
    {
      resourceUuid: z.string().describe('Application UUID'),
      envUuid: z.string().describe('Environment variable UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
      confirmEnvUuid: z.string().describe('Must match envUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, envUuid, confirmResourceUuid, confirmEnvUuid }) =>
      deleteApplicationEnvironmentVariable(client, resourceUuid, envUuid, confirmResourceUuid, confirmEnvUuid),
    ),
  );

  server.tool(
    'coolify_update_application',
    'Update an application configuration in Coolify. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Application UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm updating application configuration'),
      name: z.string().optional(),
      description: z.string().optional(),
      buildPack: z.string().optional(),
      portsExposes: z.string().optional(),
      fqdn: z.string().optional(),
      installCommand: z.string().optional(),
      buildCommand: z.string().optional(),
      startCommand: z.string().optional(),
      baseDirectory: z.string().optional(),
      dockerfile: z.string().optional(),
      dockerComposeRaw: z.string().optional(),
    },
    { destructiveHint: true },
    wrapHandler(
      async ({ resourceUuid, confirmResourceUuid, ...rest }) => {
        assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
        return updateApplication(client, resourceUuid, rest);
      },
      (args) => (args.dockerComposeRaw ? [args.dockerComposeRaw] : []),
    ),
  );

  server.tool(
    'coolify_update_service',
    'Update a service configuration in Coolify. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Service UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm updating service configuration'),
      name: z.string().optional(),
      description: z.string().optional(),
      dockerComposeRaw: z.string().optional(),
    },
    { destructiveHint: true },
    wrapHandler(
      async ({ resourceUuid, confirmResourceUuid, ...rest }) => {
        assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
        return updateService(client, resourceUuid, rest);
      },
      (args) => (args.dockerComposeRaw ? [args.dockerComposeRaw] : []),
    ),
  );

  server.tool(
    'coolify_update_database',
    'Update a database configuration in Coolify. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Database UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm updating database configuration'),
      name: z.string().optional(),
      description: z.string().optional(),
      isPublic: z.boolean().optional(),
      publicPort: z.number().optional(),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid, ...rest }) => {
      assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
      return updateDatabase(client, resourceUuid, rest);
    }),
  );

  // ==========================================
  // LIFECYCLE TOOLS (9)
  // ==========================================

  server.tool(
    'coolify_create_project',
    'Create a new project in Coolify',
    {
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
    },
    wrapHandler(async (args) => createProject(client, args)),
  );

  server.tool(
    'coolify_delete_project',
    'Deletes a project. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Project UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) =>
      deleteProject(client, resourceUuid, confirmResourceUuid),
    ),
  );

  server.tool(
    'coolify_create_application',
    'Create a new application in Coolify',
    {
      type: z.enum(['public', 'dockerfile', 'dockerimage', 'private-github-app', 'private-deploy-key']),
      projectUuid: z.string().describe('Project UUID'),
      serverUuid: z.string().describe('Server UUID'),
      environmentName: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      portsExposes: z.string().optional(),
      gitRepository: z.string().optional(),
      gitBranch: z.string().optional(),
      dockerImage: z.string().optional(),
      dockerfile: z.string().optional(),
      githubAppUuid: z.string().optional().describe('GitHub App UUID (for private-github-app)'),
      privateKeyUuid: z.string().optional().describe('Private deploy key UUID (for private-deploy-key)'),
    },
    wrapHandler(async (args) => createApplication(client, args as CreateApplicationInput)),
  );

  server.tool(
    'coolify_delete_application',
    'Deletes an application. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Application UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) =>
      deleteApplication(client, resourceUuid, confirmResourceUuid),
    ),
  );

  server.tool(
    'coolify_create_service',
    'Create a new service in Coolify',
    {
      projectUuid: z.string().describe('Project UUID'),
      serverUuid: z.string().describe('Server UUID'),
      type: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      environmentName: z.string().optional(),
      dockerComposeRaw: z.string().optional(),
    },
    wrapHandler(
      async (args) => createService(client, args),
      (args) => (args.dockerComposeRaw ? [args.dockerComposeRaw] : []),
    ),
  );

  server.tool(
    'coolify_delete_service',
    'Deletes a service. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Service UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) =>
      deleteService(client, resourceUuid, confirmResourceUuid),
    ),
  );

  server.tool(
    'coolify_create_database',
    'Create a new database in Coolify',
    {
      type: z.enum([
        'postgresql',
        'mysql',
        'mariadb',
        'mongodb',
        'redis',
        'clickhouse',
        'dragonfly',
        'keydb',
        'sqlite',
      ]),
      projectUuid: z.string().describe('Project UUID'),
      serverUuid: z.string().describe('Server UUID'),
      environmentName: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      isPublic: z.boolean().optional(),
      publicPort: z.number().optional(),
    },
    wrapHandler(async (args) => createDatabase(client, args as CreateDatabaseInput)),
  );

  server.tool(
    'coolify_delete_database',
    'Deletes a database. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Database UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) =>
      deleteDatabase(client, resourceUuid, confirmResourceUuid),
    ),
  );

  server.tool(
    'coolify_delete_server',
    'Deletes a server from Coolify. Requires confirmation by passing confirmResourceUuid matching resourceUuid.',
    {
      resourceUuid: z.string().describe('Server UUID'),
      confirmResourceUuid: z.string().describe('Must match resourceUuid to confirm deletion'),
    },
    { destructiveHint: true },
    wrapHandler(async ({ resourceUuid, confirmResourceUuid }) =>
      deleteServer(client, resourceUuid, confirmResourceUuid),
    ),
  );
}
