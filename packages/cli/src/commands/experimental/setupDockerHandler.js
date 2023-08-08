import fs from 'fs'
import path from 'path'

import { Listr } from 'listr2'

import { getConfigPath } from '@redwoodjs/project-config'
import { errorTelemetry } from '@redwoodjs/telemetry'

import { getPaths, writeFile } from '../../lib'
import c from '../../lib/colors'

import { command, description, EXPERIMENTAL_TOPIC_ID } from './setupDocker'
import { printTaskEpilogue } from './util'

export async function handler({ force, verbose }) {
  const redwoodPaths = getPaths()

  const dockerfilePath = path.join(redwoodPaths.base, 'Dockerfile')
  const dockerComposeDevFilePath = path.join(
    redwoodPaths.base,
    'docker-compose.dev.yml'
  )
  const dockerComposeProdFilePath = path.join(
    redwoodPaths.base,
    'docker-compose.prod.yml'
  )

  const tasks = new Listr(
    [
      {
        title: 'Confirmation',
        task: async (_ctx, task) => {
          const confirmation = await task.prompt({
            type: 'Confirm',
            message: 'The Dockerfile is experimental. Continue?',
          })

          if (!confirmation) {
            throw new Error('User aborted')
          }
        },
      },

      {
        title: 'Adding the experimental Dockerfile...',
        task: () => {
          const dockerfileTemplateContent = fs.readFileSync(
            path.resolve(__dirname, 'templates', 'docker', 'Dockerfile'),
            'utf-8'
          )

          return [
            writeFile(dockerfilePath, dockerfileTemplateContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },

      {
        title: 'Adding the experimental Docker compose dev file...',
        task: () => {
          const dockerComposeDevTemplateContent = fs.readFileSync(
            path.resolve(
              __dirname,
              'templates',
              'docker',
              'docker-compose.dev.yml'
            ),
            'utf-8'
          )

          return [
            writeFile(
              dockerComposeDevFilePath,
              dockerComposeDevTemplateContent,
              {
                overwriteExisting: force,
              }
            ),
          ]
        },
      },

      {
        title: 'Adding the experimental Docker compose prod file...',
        task: () => {
          const dockerComposeProdTemplateContent = fs.readFileSync(
            path.resolve(
              __dirname,
              'templates',
              'docker',
              'docker-compose.prod.yml'
            ),
            'utf-8'
          )

          return [
            writeFile(
              dockerComposeProdFilePath,
              dockerComposeProdTemplateContent,
              {
                overwriteExisting: force,
              }
            ),
          ]
        },
      },

      {
        title: 'Adding config to redwood.toml...',
        task: (_ctx, task) => {
          const redwoodTomlPath = getConfigPath()
          const configContent = fs.readFileSync(redwoodTomlPath, 'utf-8')

          if (!configContent.includes('[experimental.dockerfile]')) {
            // Use string replace to preserve comments and formatting
            writeFile(
              redwoodTomlPath,
              configContent.concat(
                `\n[experimental.dockerfile]\n\tenabled = true\n`
              ),
              {
                overwriteExisting: true, // redwood.toml always exists
              }
            )
          } else {
            task.skip(
              `The [experimental.dockerfile] config block already exists in your 'redwood.toml' file.`
            )
          }
        },
      },

      {
        task: () => {
          printTaskEpilogue(command, description, EXPERIMENTAL_TOPIC_ID)
        },
      },
    ],

    {
      rendererOptions: { collapseSubtasks: false, persistentOutput: true },
      renderer: verbose ? 'verbose' : 'default',
    }
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
