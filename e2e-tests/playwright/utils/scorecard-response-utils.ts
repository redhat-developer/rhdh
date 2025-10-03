/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export const CUSTOM_SCORECARD_RESPONSE = [
  {
    id: "github.open-prs",
    status: "success",
    metadata: {
      title: "Github open PRs",
      description:
        "Current count of open Pull Requests for a given GitHub repository.",
      type: "number",
      history: true,
    },
    result: {
      value: 9,
      timestamp: "2025-09-08T09:08:55.629Z",
      thresholdResult: {
        definition: {
          rules: [
            { key: "error", expression: ">=200" },
            { key: "warning", expression: "10-200" },
            { key: "success", expression: "<10" },
          ],
        },
        status: "success",
        evaluation: "success",
      },
    },
  },
  {
    id: "jira.open-issues",
    status: "success",
    metadata: {
      title: "Jira open blocking tickets",
      description:
        "Highlights the number of critical, blocking issues that are currently open in Jira.",
      type: "number",
      history: true,
    },
    result: {
      value: 8,
      timestamp: "2025-09-08T09:08:55.629Z",
      thresholdResult: {
        definition: {
          rules: [
            { key: "error", expression: ">=50" },
            { key: "warning", expression: "10-50" },
            { key: "success", expression: "<10" },
          ],
        },
        status: "success",
        evaluation: "success",
      },
    },
  },
];

export const EMPTY_SCORECARD_RESPONSE = [];

export const UNAVAILABLE_METRIC_RESPONSE = [
  {
    id: "jira.open-issues",
    status: "success",
    metadata: {
      title: "Jira open blocking tickets",
      description:
        "Highlights the number of critical, blocking issues that are currently open in Jira.",
      type: "number",
      history: true,
    },
    result: {
      value: 54,
      timestamp: "2025-09-12T15:28:56.898Z",
      thresholdResult: {
        definition: {
          rules: [
            {
              key: "error",
              expression: ">50",
            },
            {
              key: "warning",
              expression: "10-50",
            },
            {
              key: "success",
              expression: "<10",
            },
          ],
        },
        status: "success",
        evaluation: "error",
      },
    },
  },
  {
    id: "github.open-prs",
    status: "error",
    metadata: {
      title: "Github open PRs",
      description:
        "Current count of open Pull Requests for a given GitHub repository.",
      type: "number",
      history: true,
    },
    error:
      "HttpError: API rate limit exceeded for 157.50.94.55. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.) - https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
    result: {
      timestamp: "2025-09-23T12:17:02.496Z",
      thresholdResult: {
        definition: {
          rules: [
            {
              key: "success",
              expression: "<10",
            },
            {
              key: "warning",
              expression: "10-50",
            },
            {
              key: "error",
              expression: ">50",
            },
          ],
        },
        status: "error",
        error: "Unable to evaluate thresholds, metric value is missing",
      },
    },
  },
];

export const INVALID_THRESHOLD_RESPONSE = [
  {
    id: "jira.open-issues",
    status: "success",
    metadata: {
      title: "Jira open blocking tickets",
      description:
        "Highlights the number of critical, blocking issues that are currently open in Jira.",
      type: "number",
      history: true,
    },
    result: {
      value: 54,
      timestamp: "2025-09-12T15:28:56.898Z",
      thresholdResult: {
        definition: {
          rules: [
            {
              key: "error",
              expression: ">50",
            },
            {
              key: "warning",
              expression: "10-50",
            },
            {
              key: "success",
              expression: "<10",
            },
          ],
        },
        status: "success",
        evaluation: "error",
      },
    },
  },
  {
    id: "github.open-prs",
    status: "success",
    metadata: {
      title: "Github open PRs",
      description:
        "Current count of open Pull Requests for a given GitHub repository.",
      type: "number",
      history: true,
    },
    result: {
      value: 40,
      timestamp: "2025-09-23T12:27:04.531Z",
      thresholdResult: {
        status: "error",
        error:
          "ThresholdConfigFormatError: Invalid threshold annotation 'scorecard.io/github.open-prs.thresholds.rules.warning: 10--15' in entity 'component:default/all-scorecards-service': Invalid threshold expression: \"10--15\".",
      },
    },
  },
];
