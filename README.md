# s3code

A personal fork of [T3 Code](https://github.com/pingdotgg/t3code) by
[metasirony](https://github.com/metasirony), for working with coding agents from
desktop, web, and mobile.

This fork follows upstream and adds local Codex skill observations. The statistics
backend is available; its UI and Skill Switch are still planned. Development and
decisions are tracked in [the project map](https://github.com/metasirony/s3code/issues/1).

## Run from source

Install Node.js at the version in `package.json` and [Vite+](https://viteplus.dev/),
then install and authenticate the agent provider you want to use.

```sh
vp i
vp run dev
```

Open the URL printed by the dev runner. Each worktree uses its own development
state. For remote access, run `vp run dev --share` and use the pairing URL it prints.
See the [development guide](docs/operations/development.md) for details.

To build a Windows installer:

```sh
vp run dist:desktop:win
```

Fork releases belong on [this repository's releases page](https://github.com/metasirony/s3code/releases).
No fork release is published yet. s3code uses a separate application profile,
`s3code` command, and `~/.s3code` data directory, so it can coexist with the official
T3 Code Nightly. Keep each app's data separate; automatic import from T3 is disabled.

## Upstream and license

T3 Code is developed by [T3 Tools and its contributors](https://github.com/pingdotgg/t3code).
Its [user guides](docs/user/README.md) describe the shared functionality; references
to official downloads and hosted services refer to upstream. Planned integrations
such as Skill Switch and Excalidraw are not shipped features of this fork.

[MIT](LICENSE). Upstream attribution and third-party notices are retained.
