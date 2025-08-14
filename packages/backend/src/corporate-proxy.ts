// Copyright 2024 The Janus IDP Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { bootstrap } from 'global-agent';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/**
 * Adds support for corporate proxy to both 'node-fetch' (using 'global-agent') and native 'fetch' (using 'undici') packages.
 *
 * Ref: https://github.com/backstage/backstage/blob/master/contrib/docs/tutorials/help-im-behind-a-corporate-proxy.md
 */
export function configureCorporateProxyAgent() {
  // Bootstrap global-agent, which addresses node-fetch proxy-ing.
  // global-agent purposely uses namespaced env vars to prevent conflicting behavior with other libraries,
  // but user can set GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE to an empty value for global-agent to use
  // the conventional HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables.
  // More details in https://github.com/gajus/global-agent#what-is-the-reason-global-agentbootstrap-does-not-use-http_proxy
  bootstrap();

  // Configure the undici package, which sets things up for the native 'fetch'.
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
