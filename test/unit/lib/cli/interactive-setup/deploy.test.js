'use strict';

const chai = require('chai');
const chalk = require('chalk');
const sinon = require('sinon');
const configureInquirerStub = require('@serverless/test/configure-inquirer-stub');
const overrideEnv = require('process-utils/override-env');
const step = require('../../../../../lib/cli/interactive-setup/deploy');
const proxyquire = require('proxyquire');
const overrideStdoutWrite = require('process-utils/override-stdout-write');
const { StepHistory } = require('@serverless/utils/telemetry');

const { expect } = chai;

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

const inquirer = require('@serverless/utils/inquirer');

describe('test/unit/lib/cli/interactive-setup/deploy.test.js', () => {
  it('Should be not applied, when not at service path', async () => {
    const context = {
      options: {},
    };
    expect(await step.isApplicable(context)).to.equal(false);
    expect(context.inapplicabilityReasonCode).to.equal('NOT_IN_SERVICE_DIRECTORY');
  });

  it('Should be not applied, when service is not configured with AWS provider', async () => {
    const context = {
      configuration: { provider: { name: 'notaws' } },
      serviceDir: '/foo',
      options: {},
      history: new Map([['service', []]]),
    };
    expect(await step.isApplicable(context)).to.equal(false);
    expect(context.inapplicabilityReasonCode).to.equal('NON_AWS_PROVIDER');
  });

  it('Should be applied, if awsCredentials step was not executed which means user already had credentials', async () =>
    expect(
      await step.isApplicable({
        configuration: { provider: { name: 'aws' } },
        serviceDir: '/foo',
        options: {},
        history: new Map(),
      })
    ).to.equal(true));

  it('Should be applied if user configured local credentials', async () => {
    await overrideEnv(
      { variables: { AWS_ACCESS_KEY_ID: 'somekey', AWS_SECRET_ACCESS_KEY: 'somesecret' } },
      async () => {
        expect(
          await step.isApplicable({
            configuration: { provider: { name: 'aws' } },
            serviceDir: '/foo',
            options: {},
            history: new Map([['awsCredentials', []]]),
          })
        ).to.equal(true);
      }
    );
  });

  it('Should be applied if service instance has a linked provider', async () => {
    const mockedStep = proxyquire('../../../../../lib/cli/interactive-setup/deploy', {
      '@serverless/dashboard-plugin/lib/isAuthenticated': () => true,
      './utils': {
        doesServiceInstanceHaveLinkedProvider: () => true,
      },
    });

    expect(
      await mockedStep.isApplicable({
        configuration: { provider: { name: 'aws' }, org: 'someorg' },
        serviceDir: '/foo',
        options: {},
        history: new Map([['awsCredentials', []]]),
      })
    ).to.equal(true);
  });

  describe('run', () => {
    it('should correctly handle skipping deployment for service configured with dashboard', async () => {
      configureInquirerStub(inquirer, {
        confirm: { shouldDeploy: false },
      });

      const context = {
        serviceDir: process.cwd(),
        configuration: {
          service: 'someservice',
          provider: { name: 'aws' },
        },
        configurationFilename: 'serverless.yml',
        stepHistory: new StepHistory(),
      };
      let stdoutData = '';
      await overrideStdoutWrite(
        (data) => (stdoutData += data),
        async () => await step.run(context)
      );

      expect(stdoutData).to.include('Your project is ready for deployment');
      expect(stdoutData).to.include(`Run ${chalk.bold('serverless')} in the project directory`);
      expect(context.stepHistory.valuesMap()).to.deep.equal(new Map([['shouldDeploy', false]]));
    });

    it('should correctly handle skipping deployment for service not configured with dashboard', async () => {
      configureInquirerStub(inquirer, {
        confirm: { shouldDeploy: false },
      });

      const context = {
        serviceDir: process.cwd(),
        configuration: {
          service: 'someservice',
          provider: { name: 'aws' },
          org: 'someorg',
          app: 'someapp',
        },
        configurationFilename: 'serverless.yml',
        stepHistory: new StepHistory(),
      };
      let stdoutData = '';
      await overrideStdoutWrite(
        (data) => (stdoutData += data),
        async () => await step.run(context)
      );

      expect(stdoutData).to.include('Your project is ready for deployment');
      expect(stdoutData).to.include('Invoke your functions and view logs in the dashboard');
      expect(context.stepHistory.valuesMap()).to.deep.equal(new Map([['shouldDeploy', false]]));
    });

    it('should correctly handle deployment for service configured with dashboard', async () => {
      const mockedInit = sinon.stub().resolves();
      const mockedRun = sinon.stub().resolves();
      class MockedServerless {
        constructor() {
          this.init = mockedInit;
          this.run = mockedRun;
          this.pluginManager = {
            addPlugin: () => ({}),
            plugins: [
              {
                constructor: {
                  name: 'InteractiveDeployProgress',
                },
                progress: {},
              },
            ],
            dashboardPlugin: {},
          };
        }
      }

      const mockedStep = proxyquire('../../../../../lib/cli/interactive-setup/deploy', {
        '../../Serverless': MockedServerless,
        '@serverless/dashboard-plugin/lib/dashboard': {
          getDashboardInteractUrl: () => 'https://app.serverless-dev.com/path/to/dashboard',
        },
      });

      configureInquirerStub(inquirer, {
        confirm: { shouldDeploy: true },
      });

      const context = {
        serviceDir: process.cwd(),
        configuration: {
          service: 'someservice',
          provider: { name: 'aws' },
          org: 'someorg',
          app: 'someapp',
        },
        configurationFilename: 'serverless.yml',
        stepHistory: new StepHistory(),
      };
      let stdoutData = '';
      await overrideStdoutWrite(
        (data) => (stdoutData += data),
        async () => await mockedStep.run(context)
      );

      expect(stdoutData).to.include('Your project is live and available');
      expect(stdoutData).to.include(
        `Open ${chalk.bold('https://app.serverless-dev.com/path/to/dashboard')}`
      );

      expect(context.stepHistory.valuesMap()).to.deep.equal(new Map([['shouldDeploy', true]]));
    });

    it('should correctly handle deployment for service not configured with dashboard', async () => {
      const mockedInit = sinon.stub().resolves();
      const mockedRun = sinon.stub().resolves();
      class MockedServerless {
        constructor() {
          this.init = mockedInit;
          this.run = mockedRun;
          this.pluginManager = {
            addPlugin: () => ({}),
            plugins: [
              {
                constructor: {
                  name: 'InteractiveDeployProgress',
                },
                progress: {},
              },
            ],
          };
        }
      }

      const mockedStep = proxyquire('../../../../../lib/cli/interactive-setup/deploy', {
        '../../Serverless': MockedServerless,
      });

      configureInquirerStub(inquirer, {
        confirm: { shouldDeploy: true },
      });

      const context = {
        serviceDir: process.cwd(),
        configuration: {
          service: 'someservice',
          provider: { name: 'aws' },
        },
        configurationFilename: 'serverless.yml',
        stepHistory: new StepHistory(),
      };
      let stdoutData = '';
      await overrideStdoutWrite(
        (data) => (stdoutData += data),
        async () => await mockedStep.run(context)
      );

      expect(stdoutData).to.include('Your project is live and available');
      expect(stdoutData).to.include(`Run ${chalk.bold('serverless')}`);
      expect(context.stepHistory.valuesMap()).to.deep.equal(new Map([['shouldDeploy', true]]));
    });
  });
});
