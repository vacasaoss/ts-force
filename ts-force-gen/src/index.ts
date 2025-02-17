#! /usr/bin/env node
/// <reference types="node" />
import { requestAccessToken, setDefaultConfig } from '../../ts-force';
import { SourceFile } from 'ts-morph';
import { SObjectGenerator, TS_FORCE_IMPORTS } from './sObjectGenerator';
import * as minimist from 'minimist';
import * as fs from 'fs';
import * as path from 'path';
import { SObjectConfig, Config } from './config';
import { cleanAPIName, replaceSource } from './util';
import { Spinner } from 'cli-spinner';
import { Org, Connection, AuthInfo, Aliases } from '@salesforce/core';
import { writeFileSync } from 'fs';

// execute
run();

function run () {
  checkVersion()
    .then(generateLoadConfig)
    .then((config) => {
      if(config){
        return generate(config);
      }
    })
    .catch(e => {
      console.log('Failed to Generate!  Check config or cmd params!');
      console.log(e);
    });
}

// Checks that the installed version ts-force matches this package
async function checkVersion () {

  let tsforce: string;
  let gen: string;
  let parent: string;
  try {
    const {version, name} = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    gen = version;
    parent = name.split('/')[0] ?? ''
  } catch (e) {
    console.warn('Failed to detect package version of ts-force-gen');
    return;
  }

  for (let dir of fs.readdirSync(path.join('node_modules', parent))) {
    try {
      if (dir === 'ts-force') {
        let json = JSON.parse(fs.readFileSync(path.join('node_modules', parent, dir, 'package.json'), 'utf8'));
        tsforce = json.version;
        break;
      }
    } catch (err) { }
  }
  if (gen !== tsforce) {
    console.warn(`The version of ts-force-gen (${gen}) should match ts-force (${tsforce}). It is recommended that you run \`npm install -D ts-force-gen@${tsforce}\` and regenerate classes`);
  }
}

const baseConfig = `
{
  "$schema": "https://raw.githubusercontent.com/ChuckJonas/ts-force/master/ts-force-gen/ts-force-config.schema.json",
  "sObjects": [
    "Account",
    "Contact"
  ],
  "auth": {
    "username": "sfdxuser@example.com"
  },
  "outPath": "./src/generated/"
}
`;
const DEFAULT_TS_CONFIG_PATH = 'ts-force-config.json';
async function createConfig () {
  if(!fs.existsSync(DEFAULT_TS_CONFIG_PATH)) {
    writeFileSync(DEFAULT_TS_CONFIG_PATH, baseConfig);
  }
}

// init the configuration, either from a json file, command line augs or bo
async function generateLoadConfig (): Promise<Config> {

  let args = minimist(process.argv.slice(2));

  if(args.init){
    await createConfig();
    return null;
  }

  let config: Config = {};

  let configPath = args.config || args.j || DEFAULT_TS_CONFIG_PATH;
  if (configPath) {
    try{
      if(fs.existsSync(configPath)){
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }else{
        console.warn('No Config File Found');
      }
    }catch(e){
      console.log(`Failed to Parse config file`);
      console.error(e);
      return null;
    }
  }
  if (!config.auth) {
    config.auth = {version: 50};
  }

  // setup commandline args

  if (args.e) {
    config.auth.clientId = process.env.CLIENT_ID;
    config.auth.clientSecret = process.env.CLIENT_SECRET;
    config.auth.username = process.env.USERNAME;
    config.auth.password = process.env.PASSWORD;
    config.auth.oAuthHost = process.env.HOST;
  }

  if (args.c || args.clientId) {
    config.auth.clientId = args.c || args.clientId;
  }
  if (args.x || args.clientSecret) {
    config.auth.clientSecret = args.x || args.clientSecret;
  }
  if (args.u || args.username) {
    config.auth.username = args.u || args.username;
  }
  if (args.p || args.password) {
    config.auth.password = args.p || args.password;
  }
  if (args.h || args.oAuthHost) {
    config.auth.oAuthHost = args.h || args.oAuthHost;
  }
  if (args.accessToken || args.a) {
    config.auth.accessToken = args.accessToken || args.a;
  }
  if (args.instanceUrl || args.i) {
    config.auth.instanceUrl = args.instanceUrl || args.i;
  }
  if (args.outputFile || args.o) {
    config.outPath = args.outputFile || args.o;
  }

  if (args.sObjects || args.s) {
    config.sObjects = (args.sObjects || args.s).split(',');
  }

  if (config.auth.accessToken === undefined) {
    // no username is set, try to pull default
    if (Object.keys(config.auth).length === 0) {
      let org = await Org.create({});
      console.log(`User: ${org.getUsername()}`);
      await org.refreshAuth();
      let connection = org.getConnection();

      config.auth.accessToken = connection.accessToken;
      config.auth.instanceUrl = connection.instanceUrl;
    } else if (config.auth.username !== undefined && config.auth.password === undefined) {
      // just username is set, load from sfdx
      let username = await Aliases.fetch(config.auth.username);
      if (username) {
        config.auth.username = username;
      }
      console.log(config.auth.username);
      let connection: Connection = await Connection.create({
        authInfo: await AuthInfo.create({ username: config.auth.username }
        )
      });
      let org = await Org.create({ connection });
      await org.refreshAuth();
      connection = org.getConnection();

      config.auth.accessToken = connection.accessToken;
      config.auth.instanceUrl = connection.instanceUrl;
    } else if (config.auth.username !== undefined && config.auth.password !== undefined) {
      let oAuthResp = await requestAccessToken({
        grant_type: 'password',
        instanceUrl: config.auth.oAuthHost,
        client_id: config.auth.clientId,
        client_secret: config.auth.clientSecret,
        username: config.auth.username,
        password: config.auth.password
      });
      config.auth.instanceUrl = oAuthResp.instance_url;
      config.auth.accessToken = oAuthResp.access_token;
    } else {
      throw new Error('No valid authentication configuration found!');
    }
  }

  // could also retrieve this using sfdx
  setDefaultConfig(config.auth);

  return config;

}

// generate the classes
async function generate (config: Config) {

  let spinner = new Spinner({
    text: 'warming up...',
    stream: process.stderr,
    onTick: function (msg) {
      this.clearLine(this.stream);
      this.stream.write(msg);
    }
  });
  spinner.setSpinnerString(5);
  spinner.setSpinnerDelay(20);
  spinner.start();

  let save = true;
  if (config.outPath == null) {
    config.outPath = './placeholder.ts';
    save = false;
  }

  let singleFileMode = false;
  if (config.outPath.endsWith('.ts')) {
    singleFileMode = true;
  }

  if (config.keepNamespaces === undefined) {
    config.keepNamespaces = false;
  }

  let sobConfigs = config.sObjects.map(item => {
    let objConfig: SObjectConfig;
    if (typeof item === 'string') {
      objConfig = {
        apiName: item,
        className: null,
        autoConvertNames: true
      };
    } else {
      objConfig = item;
    }

    if (config.generatePicklists && objConfig.generatePicklists === undefined) {
      objConfig.generatePicklists = true;
    }

    if (config.keepNamespaces && objConfig.keepNamespaces === undefined) {
      objConfig.keepNamespaces = true;
    }

    if (config.enforcePicklistValues && objConfig.enforcePicklistValues === undefined) {
      objConfig.enforcePicklistValues = config.enforcePicklistValues;
    }

    objConfig.autoConvertNames = objConfig.autoConvertNames || true;
    objConfig.className = objConfig.className || sanitizeClassName(objConfig);

    return objConfig;
  });

  let index: SourceFile;
  if (singleFileMode) {
    index = replaceSource(config.outPath);
    index.addImportDeclaration(TS_FORCE_IMPORTS);
  } else {
    // create index so we can easily import
    let indexPath = path.join(config.outPath, 'index.ts');
    index = replaceSource(indexPath);
  }

  for (let sobConfig of sobConfigs) {
    spinner.setSpinnerTitle(`Generating: ${sobConfig.apiName}`);

    let classSource: string | SourceFile;
    if (singleFileMode) {
      classSource = index;
    } else {
      index.addExportDeclaration({
        moduleSpecifier: `./${sobConfig.className}`
      });
      classSource = path.join(config.outPath, `${sobConfig.className}.ts`);
    }

    let gen = new SObjectGenerator(
      classSource,
      sobConfig,
      sobConfigs
    );
    try {
      let source = await gen.generateFile();

      if (!singleFileMode) {
        source.formatText();
        if (save) {
          await source.save();
        } else {
          console.log(source.getText());
        }
      }
    } catch (error) {
      console.log(error);
      process.exit(1);
    }
  }

  index.formatText();
  if (save) {
    await index.save();
  } else {
    console.log(index.getText());
  }
  spinner.stop();

}

function sanitizeClassName (sobConfig: SObjectConfig): string {
  if (sobConfig.autoConvertNames) {
    return cleanAPIName(sobConfig.apiName, sobConfig.keepNamespaces);
  }
  return sobConfig.apiName;
}
