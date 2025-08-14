
# Local configuration (for development only)

- Create a `dynamic-plugins-root` folder at the root of the showcase application repository.

- In the `app-config.yaml` file, add the following entry:

  ```yaml
  dynamicPlugins:
    rootDirectory: dynamic-plugins-root
  ```

- Copy the dynamic plugin package to the `dynamic-plugins-root`. The following commands can be helpful:

```bash
pkg=<local dist-dynamic sub-folder or external package name of the dynamic plugin package>
archive=$(npm pack --silent $pkg )
tar -xzf "$archive" && rm "$archive"
finalName=$(echo $archive | sed -e 's:\.tgz$::')
rm -fr "$finalName"
mv package "$finalName"
```

It will create a sub-folder containing the dynamic plugin package that is named after the package name.

- Start the showcase application. During the initialization step it should have a log entry similar to the following:

```bash
backstage info loaded dynamic backend plugin '@scope/some-plugin-dynamic' from 'file:///showacase-root/dynamic-plugins-root/scope-some-plugin-dynamic-0.0.1'
```

```bash
backend:start: {"level":"info","message":"Loaded dynamic frontend plugin '<plugin-id>' from '<plugin path>' ","plugin":"scalprum","service":"backstage","timestamp":"2024-09-18 14:33:36"}

```

For frontend plugins you should see that the plugin is enabled and loaded on the Web Console:

```plaintext
Loading plugin <plugin-id> version <version>
Plugin <plugin-id> has been loaded
Plugin <plugin-id> will be enabled
```

