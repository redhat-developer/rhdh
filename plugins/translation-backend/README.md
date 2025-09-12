# translation

Welcome to the translation backend plugin!

This plugin provides a simple backend service in RHDH that serves translation files by returning their JSON content. It exposes an endpoint (/api/translation) that accepts a file path as a query parameter and reads the specified JSON translation file.

## Getting started

Your plugin has been added to the backend app in this repository, meaning you'll be able to access it by running `yarn
start-backend` in the root directory, and then navigating to [/api/translation](http://localhost:7007/api/translation).
