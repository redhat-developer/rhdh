import { Content, Header, InfoCard, Page } from '@backstage/core-components';
import { SearchContextProvider } from '@backstage/plugin-search-react';

import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { makeStyles } from 'tss-react/mui';

import { ErrorReport } from '../../common';
import { useLearningPathData } from '../../hooks/useLearningPathData';
import { useTranslation } from '../../hooks/useTranslation';
import { LearningPathLink } from '../../types/types';

const useStyles = makeStyles()({
  infoCard: {
    height: '100%',
    transition: 'all 0.25s linear',
    textAlign: 'left',
    '&:hover': {
      boxShadow: '0px 0px 16px 0px rgba(0, 0, 0, 0.8)',
    },
    '& svg': {
      fontSize: '80px',
    },
  },
});

const learningPathLengthInfo = (path: LearningPathLink) => {
  const hoursText = path.hours === 1 ? 'hour' : 'hours';
  const minutesText = path.minutes === 1 ? 'minute' : 'minutes';

  const hours = path.hours ? `${path.hours} ${hoursText}` : '';
  const minutes = path.minutes ? `${path.minutes} ${minutesText}` : '';

  return `${hours} ${minutes} | ${path.paths} learning paths`;
};

const LearningPathCards = () => {
  const { classes } = useStyles();
  const { t } = useTranslation();

  const { data, error, isLoading } = useLearningPathData();

  if (isLoading) {
    return <CircularProgress />;
  }

  if (!data) {
    return (
      <ErrorReport
        title={t('app.learningPaths.error.title')}
        errorText={t('app.learningPaths.error.unknownError')}
      />
    );
  }

  if (!isLoading && !data && error) {
    return (
      <ErrorReport
        title={t('app.learningPaths.error.title')}
        errorText={error.toString()}
      />
    );
  }

  return (
    <Grid container justifyContent="center" alignContent="center" spacing={2}>
      {data.map(p => (
        <Grid item xs={12} sm={6} md={4} lg={3} xl={3} key={p.label}>
          <Link href={p.url} target="_blank" underline="none">
            <InfoCard
              className={classes.infoCard}
              title={p.label}
              subheader={learningPathLengthInfo(p)}
            >
              <Typography paragraph>{p.description}</Typography>
            </InfoCard>
          </Link>
        </Grid>
      ))}
    </Grid>
  );
};

export const LearningPaths = () => {
  const { t } = useTranslation();

  return (
    <SearchContextProvider>
      <Page themeId="learningpaths">
        <Header title={t('app.learningPaths.title')} />
        <Content>
          <Grid container justifyContent="center">
            <Grid item>
              <LearningPathCards />
            </Grid>
          </Grid>
        </Content>
      </Page>
    </SearchContextProvider>
  );
};
