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

import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';

import { rhdhTranslationRef } from './ref';

export default createTranslationMessages({
  ref: rhdhTranslationRef,
  full: true,
  messages: {
    'menuItem.home': 'ホーム',
    'menuItem.myGroup_one': 'マイグループ',
    'menuItem.myGroup_other': 'マイグループ',
    'menuItem.catalog': 'カタログ',
    'menuItem.apis': 'API',
    'menuItem.learningPaths': 'ラーニングパス',
    'menuItem.selfService': 'セルフサービス',
    'menuItem.userSettings': 'ユーザー設定',
    'menuItem.administration': '管理',
    'menuItem.extensions': '拡張機能',
    'menuItem.clusters': 'クラスター',
    'menuItem.rbac': 'RBAC',
    'menuItem.bulkImport': '一括インポート',
    'menuItem.docs': 'ドキュメント',
    'menuItem.lighthouse': 'Lighthouse',
    'menuItem.techRadar': 'Tech Radar',
    'menuItem.orchestrator': 'オーケストレーター',
    'menuItem.adoptionInsights': 'Adoption Insights',
    'sidebar.menu': 'メニュー',
    'sidebar.home': 'ホーム',
    'sidebar.homeLogo': 'ホームロゴ',
    'signIn.page.title': 'サインイン方法の選択',
    'signIn.providers.auth0.title': 'Auth0',
    'signIn.providers.auth0.message': 'Auth0 を使用してサインイン',
    'signIn.providers.atlassian.title': 'Atlassian',
    'signIn.providers.atlassian.message': 'Atlassian を使用してサインイン',
    'signIn.providers.microsoft.title': 'Microsoft',
    'signIn.providers.microsoft.message': 'Microsoft を使用してサインイン',
    'signIn.providers.bitbucket.title': 'Bitbucket',
    'signIn.providers.bitbucket.message': 'Bitbucket を使用してサインイン',
    'signIn.providers.bitbucketServer.title': 'Bitbucket Server',
    'signIn.providers.bitbucketServer.message':
      'Bitbucket Server を使用してサインイン',
    'signIn.providers.github.title': 'GitHub',
    'signIn.providers.github.message': 'GitHub を使用してサインイン',
    'signIn.providers.gitlab.title': 'GitLab',
    'signIn.providers.gitlab.message': 'GitLab を使用してサインイン',
    'signIn.providers.google.title': 'Google',
    'signIn.providers.google.message': 'Google を使用してサインイン',
    'signIn.providers.oidc.title': 'OIDC',
    'signIn.providers.oidc.message': 'OIDC を使用してサインイン',
    'signIn.providers.okta.title': 'Okta',
    'signIn.providers.okta.message': 'Okta を使用してサインイン',
    'signIn.providers.onelogin.title': 'OneLogin',
    'signIn.providers.onelogin.message': 'OneLogin を使用してサインイン',
    'signIn.providers.saml.title': 'SAML',
    'signIn.providers.saml.message': 'SAML を使用してサインイン',
    'catalog.entityPage.overview.title': '概要',
    'catalog.entityPage.topology.title': 'トポロジー',
    'catalog.entityPage.issues.title': 'イシュー',
    'catalog.entityPage.pullRequests.title': 'プル/マージリクエスト',
    'catalog.entityPage.ci.title': 'CI',
    'catalog.entityPage.cd.title': 'CD',
    'catalog.entityPage.kubernetes.title': 'Kubernetes',
    'catalog.entityPage.imageRegistry.title': 'イメージレジストリー',
    'catalog.entityPage.monitoring.title': 'モニタリング',
    'catalog.entityPage.lighthouse.title': 'Lighthouse',
    'catalog.entityPage.api.title': 'API',
    'catalog.entityPage.dependencies.title': '依存関係',
    'catalog.entityPage.docs.title': 'ドキュメント',
    'catalog.entityPage.definition.title': '定義',
    'catalog.entityPage.diagram.title': 'システム図',
    'catalog.entityPage.workflows.title': 'ワークフロー',
    'app.search.title': '検索',
    'app.search.resultType': '結果タイプ',
    'app.search.softwareCatalog': 'ソフトウェアカタログ',
    'app.search.filters.kind': '種類',
    'app.search.filters.lifecycle': 'ライフサイクル',
    'app.search.filters.component': 'コンポーネント',
    'app.search.filters.template': 'テンプレート',
    'app.search.filters.experimental': '実験的',
    'app.search.filters.production': '実稼働',
    'app.learningPaths.title': 'ラーニングパス',
    'app.learningPaths.error.title': 'データを取得できませんでした。',
    'app.learningPaths.error.unknownError': '不明なエラー',
    'app.userSettings.infoCard.title': 'RHDH メタデータ',
    'app.userSettings.infoCard.metadataCopied':
      'メタデータがクリップボードにコピーされました',
    'app.userSettings.infoCard.copyMetadata':
      'メタデータをクリップボードにコピーする',
    'app.userSettings.infoCard.showLess': '簡易表示',
    'app.userSettings.infoCard.showMore': '詳細表示',
    'app.errors.contactSupport': 'サポートにお問い合わせください',
    'app.errors.goBack': '戻る',
    'app.errors.notFound.message': '該当するページが見つかりませんでした',
    'app.errors.notFound.additionalInfo':
      'お探しのページは削除されたか、名前が変更されたか、一時的に利用できない可能性があります。',
    'app.table.createdAt': '作成日時',
  },
});
