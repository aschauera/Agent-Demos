# Connect hr-systems-expert to Microsoft Teams

`azd deploy` already did the Azure side for you:

- Azure Bot: `hr-systems-expert-bot-673b5697` (Microsoft Teams channel enabled)
- Bot ID (msaAppId): `8740d0d1-5438-4cf9-8d02-57a26ca7410b`
- Teams app package: `appPackage.zip` (generated next to this guide, ready to sideload)

One step remains: sideload the package to try your agent. Pick ONE of the two ways
below — both are per-user installs and need NO Teams admin.

## Sideload — Teams UI (no extra tooling)

1. In Teams, go to **Apps** -> **Manage your apps** -> **Upload an app**.
2. Select **Upload a custom app**, choose `appPackage.zip`, then **Add**.
3. Select **Open**, then send a message to talk to your agent.

Upload a custom app guide: https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/apps-upload

## Or sideload — command line (atk)

The Microsoft 365 Agents Toolkit CLI (atk) installs the same package from a terminal.
`--scope Personal` is a per-user install and needs NO Teams admin:

```sh
npm install -g @microsoft/m365agentstoolkit-cli   # one-time; requires Node.js
atk auth login                                     # sign in with your M365 account
atk install --file-path appPackage.zip --scope Personal
```

atk prints a TitleId and a Teams deep link you can open to launch the agent.
atk CLI reference: https://learn.microsoft.com/microsoftteams/platform/toolkit/microsoft-365-agents-toolkit-cli

If **Upload a custom app** is missing or greyed out, custom app upload is turned off for
your tenant, or you want everyone in your org to get it from the org app catalog. Both need
a Teams admin: https://learn.microsoft.com/microsoftteams/platform/concepts/build-and-test/prepare-your-o365-tenant
