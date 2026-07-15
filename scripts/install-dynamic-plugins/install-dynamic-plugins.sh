#!/bin/sh

#
# Copyright Red Hat, Inc.
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

# RHDHBUGS-3449: forward SIGTERM to the whole process group so skopeo/npm/openssl
# children are terminated instead of outliving the container's grace period.
# `kill 0` sends TERM to this shell too, so the trap must disarm itself first
# (`trap - TERM`) or it re-triggers itself in an infinite loop.
trap 'trap - TERM; kill 0' TERM
python install-dynamic-plugins.py "$1" &
wait $!
