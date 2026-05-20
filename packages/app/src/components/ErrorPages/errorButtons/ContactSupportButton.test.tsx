import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';

import { screen } from '@testing-library/react';

import { ContactSupportButton } from './ContactSupportButton';

jest.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderButton = async (
  props: { supportUrl?: string } = {},
  configData: object = {},
) =>
  renderInTestApp(
    <TestApiProvider
      apis={[[configApiRef, mockApis.config({ data: configData })]]}
    >
      <ContactSupportButton {...props} />
    </TestApiProvider>,
  );

const supportLink = () =>
  screen.getByRole('link', { name: 'app.errors.contactSupport' });

describe('ContactSupportButton', () => {
  it('prefers the explicit supportUrl prop', async () => {
    await renderButton(
      { supportUrl: 'https://prop.example.com' },
      { app: { support: { url: 'https://config.example.com' } } },
    );

    expect(supportLink()).toHaveAttribute('href', 'https://prop.example.com');
  });

  it('falls back to the configured support URL', async () => {
    await renderButton(
      {},
      { app: { support: { url: 'https://config.example.com' } } },
    );

    expect(supportLink()).toHaveAttribute('href', 'https://config.example.com');
  });

  it('falls back to the default Red Hat support URL', async () => {
    await renderButton({}, {});

    expect(supportLink()).toHaveAttribute(
      'href',
      'https://access.redhat.com/documentation/red_hat_developer_hub',
    );
  });
});
