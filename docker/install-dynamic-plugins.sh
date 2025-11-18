#!/bin/sh

#
# Copyright (c) 2023 Red Hat, Inc.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

python install-dynamic-plugins.py $1

# Run cleanup to reduce disk usage (if enabled via CLEANUP_DYNAMIC_PLUGINS env var)
if [ "${CLEANUP_DYNAMIC_PLUGINS:-false}" = "true" ]; then
  if [ -f "./cleanup-dynamic-plugins.sh" ]; then
    echo "======= Running dynamic plugins cleanup..."
    ./cleanup-dynamic-plugins.sh $1
  else
    echo "======= WARNING: CLEANUP_DYNAMIC_PLUGINS is enabled but cleanup-dynamic-plugins.sh not found. Skipping cleanup."
  fi
fi
