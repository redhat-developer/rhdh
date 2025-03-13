# Setup Cache service with Redis Cache
To complete this setup, you need an active Redis server. 
A good option when deploying on Openshift is using *Redis Enterprise Operator* provided by Redis (marked as Certified, official Redis Docs [here](https://redis.io/docs/latest/operate/kubernetes/deployment/openshift/openshift-operatorhub/)), but any Redis instance should be fine; feel free to chose any deployment method you prefer.

To enable the Cache service in RHDH, you need to add the following configuration to your app-config.yaml:

```
backend:
  cache:
    store: redis
    connection: redis://user:pass@cache.example.com:PORT
```
The `useRedisSets` option is no longer supported (from RHDH 1.5).

## Use Redis with plugins
The plugins using Redis are Techdocs (production-ready) and Bulk-import (tech preview).

To use Redis with Techdocs, make sure you set the ttl parameter in the Techdocs section of your configuration, or the items won't be cached:
```
# File: app-config.yaml

techdocs:
  # techdocs.generator is used to configure how documentation sites are generated using MkDocs.
  .
  .
  .
  cache:
    # Represents the number of milliseconds a statically built asset should
    # stay cached. Cache invalidation is handled automatically by the frontend,
    # which compares the build times in cached metadata vs. canonical storage,
    # allowing long TTLs (e.g. 1 month/year)
    ttl: 3600000

    # (Optional) The time (in milliseconds) that the TechDocs backend will wait
    # for a cache service to respond before continuing on as though the cached
    # object was not found (e.g. when the cache service is unavailable). The
    # default value is 1000
    readTimeout: 500
```

## Troubleshooting
The logs will no show any hint of the cache service being running correctly. You can set more verbose logging by passing the enviroment variable `LOG_LEVEL=debug` to your RHDH instance. 
You will only see error logs when a cache read is requested by any of the plugins (for example, when opening a Techdocs page).
Some examples:
- if you see errors like:
  ```
  {"level":"\u001b[31merror\u001b[39m","message":"Request failed with status 500 NOAUTH Authentication required","plugin":"techdocs","service":"backstage","span_id":"f2f0499492ded848","timestamp":"2025-02-20 13:37:03","trace_flags":"01","trace_id":"c750094ef56da1412f217c3a2cd01ded","type":"errorHandler"}
  ```
  or
  ```
  {"level":"\u001b[31merror\u001b[39m","message":"Failed to create redis cache client WRONGPASS invalid username-password pair","service":"backstage","span_id":"cfaf6a6a2031a34d","timestamp":"2025-02-20 13:27:15","trace_flags":"01","trace_id":"c0196b4be2bb94bba433290d8311d18b","type":"cacheManager"}
  ```
  make sure you have setup at least a password for the dafault user (or better, a proper user with the rights to access your Redis database) and that you are providing the correct values in the connection string
- if you are a using ssl/tls (i.e. `rediss://user:pass@cache.example.com:PORT`), make sure all the certificates are in place and valid; if you are using self-signed certificates, the connection will probably fail to validate the CA; **for testing porpuses only**, you can set the `NODE_TLS_REJECT_UNAUTHORIZED=0` enviromnment variable to overcome this issue 
