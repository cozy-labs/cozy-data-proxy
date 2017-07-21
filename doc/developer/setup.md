# Setting Up a Development Environment

The following commands should work in a Unix shell (Bash or ZSH for example)
and in Windows PowerShell.

## Install requirements

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/)
- [Docker](https://www.docker.com/) unless you already have a Cozy stack setup
  (see [below](#set-up-a-cozy-stack)).

### Windows

If you don't own a Windows license but you still need to build / test the app
on Windows, you can use the
[free virtual machines](https://developer.microsoft.com/en-us/microsoft-edge/tools/vms/)
provided by Microsoft, either in [VirtualBox](https://www.virtualbox.org/) or
any of the hypervisors supporting the available VM file formats.

**The following assumes you run commands from an administrator command prompt**

To get an administrator prompt, look for *Command Prompt* in the start menu,
right-click on it and select *Run as administrator*.

Once you are in a running Windows session, you can eventually install
[Chocolatey](https://chocolatey.org/) from an administrator prompt, then use
it to install the requirements above (or you can download and install each of
the installers):

    choco install git
    choco install nodejs-lts
    choco install yarn

Right now the *nodejs-lts* package seems to be broken, you may need to install
the latest Node 6.x by hand.

You may also need at some point to restart the *Command Prompt*, the whole
system, or refresh your environment variables using the`refreshenv` command.

Then install the Windows build tools from an admin console as documented in the
[Microsoft's Node.js guidelines](https://github.com/Microsoft/nodejs-guidelines/blob/master/windows-environment.md#environment-setup-and-configuration):

    npm install -g windows-build-tools

You may still need to manually add the python installation directory to your
`PATH`.
To do so, search for *PATH* from the start menu and select
*Edit environment variables for your account*.
Then edit the `PATH` user variable (not the system one) and append the
following to the end (assuming `...` is the current text):

    `...;%USERPROFILE%\.windows-build-tools\python27`

To set up Docker, in case you hardware is old or you don't own a Windows Pro
license, you may encounter the same issue as on old macOS hardware (see below).
*(please feel free to improve this section)*


### macOS

You need a Mac to build / test for macOS.

The easiest way to set up the environment is to install and use
[Homebrew](https://brew.sh/):

    brew install git
    brew install node
    brew install yarn

To install Docker, first check that your mac has kernel hypervisor support:

    sysctl -n kern.hv_support

If the output is `1`, then you can install the latest Docker version:

    brew cask install docker

Otherwise you'll have to install a Docker VM and set up your shell environment
so the various docker commands know how to use it (you can omit the `default`
parameters below):

    brew cask install docker-toolbox
    docker-machine create default
    eval $(docker-machine env default)


## Get the code

```
git clone git@github.com:cozy-labs/cozy-desktop.git
cd cozy-desktop
```

## Install dependencies

```
yarn install
```


## Set up a Cozy stack

If you don't already have a [running Cozy stack](https://github.com/cozy/cozy-stack/blob/master/docs/INSTALL.md), the easiest way to get started is to use Docker:

    cd cli
    docker-compose up
    yarn bootstrap

Otherwise, please refer to the
[../../cli/dev/docker/bootstrap-cozy-desktop.sh]()
script to create the appropriate instances, token, etc...


## Build everything

```
yarn build
```


## Run tests

See [./test.md]().
