# Contributing

We are excited to see you want to be a part of this project by contributing. Here is some information on how to get started, as well as some knowledge on our requirements.

## Get Started

### Clone and Install

```bash
git clone https://github.com/your-username/rhdh.git   # Clone your forked repository
cd rhdh                                               # Change to the project directory
yarn install                                          # Install dependencies
yarn tsc                                              # Run type generation and checks
```

### Run the Showcase App

We currently have quite a bit of moving parts for the showcase application. As such, we have documentation dedicated to the requirements for running the showcase app under [getting-started.md](https://github.com/redhat-developer/rhdh/blob/main/docs/index.md).

### Useful Scripts

Our project uses [Turborepo](https://turbo.build/repo) for running scripts across packages efficiently. Here are some useful scripts used in the project:

```bash
yarn start             # Starts the backend application
yarn dev               # Starts both backend and frontend applications
yarn build             # Builds all packages
yarn tsc               # Runs TypeScript type checks across all packages
yarn test              # Runs tests across all packages
yarn lint:check        # Checks for linting errors across all packages
yarn lint:fix          # Fixes linting errors automatically across all packages
yarn prettier:check    # Checks for formatting issues across all packages
yarn prettier:fix      # Fixes formatting issues automatically across all packages
yarn clean             # Cleans up build artifacts across all packages
```

## Contributions

We welcome code and non-code contributions to our project. Non-code contributions can come in the form of documentation updates, bug reports, enhancement requests, and feature requests.

### Finding Issues to Work On

Want to submit some changes to the code? The best place to start is to look through our issues for [bugs](https://github.com/redhat-developer/rhdh/issues?q=is%3Aopen+is%3Aissue+label%3Akind%2Fbug), [good first issues](https://github.com/redhat-developer/rhdh/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22), and [help wanted](https://github.com/redhat-developer/rhdh/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22). These are a great starting point for new contributors.

### Bug Reporting

If you found a bug in our showcase app, please submit an [issue](https://github.com/redhat-developer/rhdh/issues/new?assignees=&labels=kind%2Fbug%2Cstatus%2Ftriage&template=bug.md) describing the problem that you ran into. Important information to include:

- Steps to reproduce the bug
- The `app-config.yaml` that is being used (**remember to remove all secrets before sharing**)
- Any relevant logs

This will help us narrow down the potential cause of the bug and speed up the time it takes to solve the problem at hand.

### Updating Backstage Dependencies

To update Backstage dependencies, run the following command:

```bash
yarn versions:bump     # Updates Backstage dependencies
```

### Enhancement Requests

If you want an enhancement of a feature or workflow, you can submit an [issue](https://github.com/redhat-developer/rhdh/issues/new?assignees=&labels=kind%2Fenhancement%2Cstatus%2Ftriage&template=enhancement.md) describing the enhancement. Include:

- What you are wanting to see improved
- The current behavior
- The new behavior you wish to see

### Feature Requests

If you want to see a new feature within the showcase app, file an [issue](https://github.com/redhat-developer/rhdh/issues/new?assignees=&labels=kind%2Ffeature%2Cstatus%2Ftriage&template=feature.md) detailing the new feature. Include:

- What you are trying to achieve with the new feature
- What you will need
- Who will have access
- Any relevant documentation or information on the new feature

### Documentation

Documentation is another option for contributing to us. If there is documentation that is unclear or could use some improvements, please raise an issue or submit a pull request.

### Pull Requests

If you want to submit code changes to the project, here are some guidelines:

1. **Create a Branch**

   ```bash
   git checkout -b your-feature-branch  # Create a new branch for your feature
   ```

2. **Implement Your Changes**

   Make your code changes, ensuring that you follow the project's coding standards and best practices.

3. **Testing**

   - **Run Tests:** Ensure all tests pass before committing.

     ```bash
     yarn test         # Run unit tests
     cd e2e-tests
     yarn showcase     # Run e2e tests
     ```

     _For more on the e2e, check the [e2e contributing guidelines](./docs/e2e-tests/CONTRIBUTING.MD)_

   - **Note on Environment Dependencies:**

     - If your new or edited code can't be validated locally due to environment dependencies, you can open a **draft Pull Request (PR)**. This allows the tests to run on the test environment as described in our CI documentation.

4. **Linting and Formatting**

   Ensure your code passes linting and formatting checks.

   ```bash
   yarn lint:check     # Checks for linting errors
   yarn lint:fix       # Fixes linting errors automatically
   yarn prettier:check # Checks for formatting issues
   yarn prettier:fix   # Fixes formatting issues automatically
   ```

5. **Ensure CI Passes**

   Your contributions will need to pass the Continuous Integration (CI) tests for pull requests.

6. **Commit Changes**

   Use meaningful commit messages following the [Conventional Commits](https://www.conventionalcommits.org/) specification.

   ```bash
   git commit -m "feat: add new feature"  # Commit your changes with a meaningful message
   ```

7. **Update Documentation**

   If there will be changes to the [app config](app-config.yaml), we ask that [documentation](README.md#getting-started) be updated if it will be a requirement for running the app. We also ask to ensure that the app will still work in the case of dummy information being supplied to the app config. While it is not a hard requirement, it does help others with quickly being able to get up and running with the showcase app.

8. **Push to Your Fork**

   ```bash
   git push origin your-feature-branch    # Push your branch to your fork
   ```

9. **Open a Pull Request**

   Go to the original repository and click on **New Pull Request**. Provide a clear description of your changes, including any issues your PR fixes, acceptance criteria, and any special notes to the reviewers.

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat`: A new feature.
- `fix`: A bug fix.
- `docs`: Documentation changes.
- `style`: Code style changes (formatting, missing semi-colons, etc.).
- `refactor`: Code changes that neither fix a bug nor add a feature.
- `test`: Adding or correcting tests.
- `chore`: Changes to the build process or auxiliary tools.

### Adding Statically Linked Plugins for Frontend and Backend

When contributing a new `@internal` plugin into this repo, you must remember to add the plugin to the Dockerfiles under the section titled `Stage 2 - Install dependencies`:

- [Upstream Dockerfile](.rhdh/docker/Dockerfile)
- [Downstream Dockerfile](docker/Dockerfile)

For example:

```dockerfile
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info/package.json ./plugins/dynamic-plugins-info/package.json
```

## Support

You can reach out to us in our [community Slack channel](https://join.slack.com/t/janus-idp/shared_invite/zt-1pxtehxom-fCFtF9rRe3vFqUiFFeAkmg) if you run into any issues with setup, running, or testing the application. Members of the team and community can assist you with questions and concerns you might have. Even if you don't need help, please consider joining and being involved in our community.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](https://github.com/redhat-developer/rhdh/blob/main/LICENSE).
