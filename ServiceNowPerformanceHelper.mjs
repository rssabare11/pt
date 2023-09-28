import puppeteer from 'puppeteer';
import PuppeteerHar from 'puppeteer-har';
import testProperties from './testProperties.json' assert{ type: 'json' };
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { exec } from "child_process";
import { JSDOM } from 'jsdom';
import { readdirSync } from 'fs';
import csv from 'csv-parser';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import lighthouse from 'lighthouse';
import Papa from 'papaparse';


class ServiceNowPerformanceTestError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ServiceNowPerformanceTestError';
    }
}

export default class ServiceNowPerformanceTestHelper {
    constructor() {
        this.loopCount = 0;
        this.currentLoop = 0;
        this.currentDir = fileURLToPath(import.meta.url);
        this.currentDirPath = path.dirname(this.currentDir);
        this.suiteId = this.generateSuiteId(testProperties.testSettings.suiteName)
        this.testId = this.generateTestId(); // Generate a unique test ID
        this.folderName = `${this.testId}`;
        this.folderPath = path.join(this.currentDirPath, this.folderName);
        this.testFolderPath = this.createFolderWithTestId(this.folderPath);
        this.SpeedometerScore = 0;
        this.OctaneScore = 0;
    }

    async  processHarFiles(folderPath) {
        const pythonScriptPath = testProperties.testSettings.pythonScriptPath;
        const pythonExecutable = testProperties.testSettings.pythonExecutable; // Change this to the full path of the Python executable inside the virtual environment
      
        exec(`${pythonExecutable} ${pythonScriptPath} ${folderPath}`, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error executing the Python script: ${error.message}`);
            return;
          }
          if (stderr) {
            console.error(`Error in the Python script: ${stderr}`);
            return;
          }
          console.log(`Python script output: ${stdout}`);
        });
      }
      
    async  executeActionsAcrossIterations(page, actions, speedometerResult, octaneResult) {
        if (!page || !actions || !Array.isArray(actions) || actions.length === 0) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for executeActionsInSingleIterationRepeatedly method');
        }
        this.SpeedometerScore = speedometerResult;
        this.OctaneScore = octaneResult;
        this.loopCount = testProperties.testSettings.iterationsCount;
        console.log(this.loopCount);
        // const testId = this.generateTestId(); // Generate a unique test ID
        for (let cycle = 0; cycle < this.loopCount; cycle++) {
            this.currentLoop = cycle + 1;
            console.log(`Starting cycle ${this.currentLoop}...`);

            try {
                await this.executeActionsInSingleIteration(page, actions,this.testId);
            } catch (error) {
                console.error(`Error occurred during cycle ${this.currentLoop}:`, error);
            }
            if(this.currentLoop == this.loopCount)
            {
                this.computeStatsFromCSV(this.folderName+"/timings.csv", 'summary.csv');
                this.processHarFiles(this.folderName);
                console.log(`Before timeout generate report`);
                let timeout = this.loopCount * 30000; // timeout in milliseconds
                await page.waitForTimeout(timeout);
                console.log(`after timeout geenerate html`);
                this.generateReport(this.folderPath);
            }
        }
    }
    async runLighthouse(page) {
        // Get the current URL
        const url = await page.url();
        let duration = null;
      
        // Get the browser port to use with Lighthouse
        const browserPort = new URL(page.browser().wsEndpoint()).port;
      
        // Lighthouse options
        const lighthouseOpts = {
          onlyCategories: ['performance'],
          emulatedFormFactor: 'none',
          screenEmulation: {
            mobile: false,
            width: 1920,
            height: 1080,
          },
          throttling: {
            rttMs: 0,
            throughputKbps: 40960,
            cpuSlowdownMultiplier: 1,
            requestLatencyMs: 0,
          },
          port: browserPort,
        };
      
        // Lighthouse config
        const lighthouseConfig = {
          extends: 'lighthouse:default',
          settings: {
            formFactor: 'desktop',
            screenEmulation: {
              mobile: false,
              width: 1920,
              height: 1080,
            },
          },
        };
      
        // Run Lighthouse audits
        const lighthouseResult = await lighthouse(url, lighthouseOpts, lighthouseConfig);
        const { audits } = lighthouseResult.lhr;
      

        // Return Lighthouse results
        return {
            url: url || null,
            duration: duration|| null,
            speedIndex: audits['speed-index']?.displayValue || null,
            timeToInteractive: audits['interactive']?.displayValue || null,
            firstContentfulPaint: audits['first-contentful-paint']?.displayValue || null,
            largestContentfulPaint: audits['largest-contentful-paint']?.displayValue || null,
            performanceScore: lighthouseResult.lhr.categories.performance.score,
            totalBlockingTime: audits['total-blocking-time']?.displayValue || null,
            cumulativeLayoutShift: audits['cumulative-layout-shift']?.displayValue || null,
            firstMeaningfulPaint: audits['first-meaningful-paint']?.displayValue || null,
            maxPotentialFID: audits['max-potential-fid']?.displayValue || null,
            serverResponseTime: audits['server-response-time']?.displayValue || null,
            renderBlockingResources: audits['render-blocking-resources']?.displayValue || null,
            efficientCachePolicy: audits['uses-long-cache-ttl']?.displayValue || null,
            mainThreadWork: audits['mainthread-work-breakdown']?.displayValue || null,
            domSize: audits['dom-size']?.displayValue || null,
            bootupTime: audits['bootup-time']?.displayValue || null,
            unusedCSS: audits['unused-css-rules']?.displayValue || null,
            unusedJS: audits['unused-javascript']?.displayValue || null,
            redirects: audits['redirects']?.displayValue || null,
            networkServerLatency: audits['network-server-latency']?.displayValue || null
        };
            
      }

    async  executeActionsInSingleIteration(page, actions, testId) {
        try {
            console.log('Entering executeActionsInSingleIteration...');
    
            for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
    
                if (action.loopId) {
                    const loopId = action.loopId;
                    const numberOfCycles = action.numberOfCycles || 1;
    
                    console.log(`Starting loop "${loopId}"...`);
    
                    for (let cycle = 0; cycle < numberOfCycles; cycle++) {
                        console.log(`Starting inner cycle ${cycle + 1} for loop "${loopId}"...`);
    
                        for (let j = i; j < actions.length && actions[j].loopId === loopId; j++) {
                            const currentAction = actions[j];
                            console.log(`Executing action "${currentAction.name}"...`);
    
                            const harFilePath = `${currentAction.name}_${testId}_${this.currentLoop}_${cycle + 1}.har`;
                            const traceFilePath = `${currentAction.name}_${testId}_${this.currentLoop}_${cycle + 1}.json`;
                            const updatedHarFilePath = path.join(this.testFolderPath, harFilePath);
                            const updatedTraceFilePath = path.join(this.testFolderPath, traceFilePath);
    
                            const duration = await this.executeActionAndCapturePerformance(page, currentAction, updatedHarFilePath, updatedTraceFilePath);
                            console.log(`Action "${currentAction.name}" took ${duration.duration}ms`);
                            await this.appendTimingToCSV(this.suiteId, this.testId, this.currentLoop, currentAction.name, currentAction.type, currentAction.Url, duration);
    
                            if (!currentAction.groupWithNextAction) {
                                console.log('Not grouping with next action. Breaking the inner loop.');
                                break; // Exit the inner loop if there are no more actions to group
                            }
                        }
                    }
    
                    // Skip to the end of the grouped actions
                    while (i + 1 < actions.length && actions[i + 1].loopId === loopId) {
                        i++;
                    }
                } else {
                    console.log(`Executing single action "${action.name}"...`);
    
                    const harFilePath = `${action.name}_${testId}_${this.currentLoop}.har`;
                    const traceFilePath = `${action.name}_${testId}_${this.currentLoop}.json`;
                    const updatedHarFilePath = path.join(this.testFolderPath, harFilePath);
                    const updatedTraceFilePath = path.join(this.testFolderPath, traceFilePath);
    
                    const duration = await this.executeActionAndCapturePerformance(page, action, updatedHarFilePath, updatedTraceFilePath);
                    console.log(`Action "${action.name}" took ${duration.duration}ms`);
                    await this.appendTimingToCSV(this.suiteName,this.testId, this.currentLoop, action.name, action.type, action.Url, duration);
                }
            }
        } catch (error) {
            console.error('Error in executeActionsInSingleIteration:', error);
            throw new ServiceNowPerformanceTestError('Unable to execute actions in a single iteration');
        }
    }

    async executeActionAndCapturePerformance(page, action, harFilePath, traceFilePath) {
        let harActive = false;
        let tracingActive = false;
        let recordingActive = false;
        let har;
        // Create a new recorder
        const recorder = new PuppeteerScreenRecorder(page);
        const videoFilePath = harFilePath.replace('.har', '.mp4');

        try {
            // Create a new PuppeteerHar instance and start recording
            har = new PuppeteerHar(page);
            await har.start({ path: harFilePath });
            harActive = true;
            // Start the video recording
            await recorder.start(videoFilePath);
            recordingActive = true;

            // Start tracing network activity
           // await page.tracing.start({ path: traceFilePath });
            tracingActive = true;
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Measure performance timing
            const duration = await this.performActionAndMeasureDuration(page, action, harFilePath, traceFilePath);
                    // Capture a screenshot
            const screenshotFilePath = harFilePath.replace('.har', '.png');
            await page.screenshot({ path: screenshotFilePath });
            await new Promise(resolve => setTimeout(resolve, 5000));
            // Return the duration
            return duration;
        } catch (error) {
            console.error('Error in executeActionAndCapturePerformance:', error);
            throw new ServiceNowPerformanceTestError('Unable to perform action and capture performance data');
        } finally {
            // Stop the HAR and tracing recordings if active
            if (harActive) {
                await har.stop();
            }
            if (tracingActive) {
               // await page.tracing.stop();
            }

            // Stop the video recording if active
            if (recordingActive) {
                await recorder.stop();
            }
                
        }
    } 
    
/*     async executeActionAndCapturePerformance(page, action, harFilePath, traceFilePath) {
        let harActive = false;
        let tracingActive = false;
        let recordingActive = false;
        let cdpActive = false;
        let har;
        let client;
    
        // This will collect all trace events
        const traceEvents = [];
    
        // Create a new recorder
        const recorder = new PuppeteerScreenRecorder(page);
        const videoFilePath = harFilePath.replace('.har', '.mp4');
    
        try {
            // Create a new PuppeteerHar instance and start recording
            har = new PuppeteerHar(page);
            await har.start({ path: harFilePath });
            harActive = true;

                        // Check if tracing is active
            // if (tracingActive) {
            //     // Stop tracing
            //     await page.tracing.stop();
            //     tracingActive = false;
            // }

            // // Start new trace
            // await page.tracing.start({ path: traceFilePath });
            // tracingActive = true;

            // if (tracingActive) {
            //     // Stop tracing
            //     await page.tracing.stop();
            //     tracingActive = false;
            // }
    
            // Start the video recording
            await recorder.start(videoFilePath);
            recordingActive = true;
    
            // Create a CDP session and start tracing
            client = await page.target().createCDPSession();
            client.on('Tracing.dataCollected', (data) => {
                traceEvents.push(...data.value);
            });

            
            await client.send('Tracing.start', {
                "categories": ["devtools.timeline", "v8.execute", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "blink.console", "blink.user_timing", "latencyInfo", "disabled-by-default-devtools.timeline.stack", "disabled-by-default-v8.cpu_profiler", "disabled-by-default-v8.cpu_profiler.hires"].join(','),
                "options": "sampling-frequency=10000"  // 1000 is default and too slow.
            });
            cdpActive = true;
    
            // Measure performance timing
            const duration = await this.performActionAndMeasureDuration(page, action, harFilePath, traceFilePath);
    
            // Capture a screenshot
            const screenshotFilePath = harFilePath.replace('.har', '.png');
            await page.screenshot({ path: screenshotFilePath });

            if (cdpActive) {
                // Stop the CDP tracing and save the results to a file
                await client.send('Tracing.end');
                await client.once('Tracing.tracingComplete', () => {
                    console.log('Tracing ended.');
                });
                fs.writeFileSync(traceFilePath, JSON.stringify(traceEvents));
            }    
            //Return the duration
            return duration;
        } catch (error) {
            console.error('Error in executeActionAndCapturePerformance:', error);
            throw new ServiceNowPerformanceTestError('Unable to perform action and capture performance data');
        } finally {
            // Stop the HAR and tracing recordings if active
            if (harActive) {
                await har.stop();
            }
            if (tracingActive) {
                await page.tracing.stop();
            }
    
            // Stop the video recording if active
            if (recordingActive) {
                await recorder.stop();
            }
    
            // if (cdpActive) {
            //     // Stop the CDP tracing and save the results to a file
            //     await client.send('Tracing.end');
            //     await client.once('Tracing.tracingComplete', () => {
            //         console.log('Tracing ended.');
            //     });
            //     fs.writeFileSync(traceFilePath, JSON.stringify(traceEvents));
            // }
        }
    } */

    async waitForJsPath(page, jsPath, timeout = 3000) {
        const startTime = new Date().getTime();
        let currentTime = new Date().getTime();
    
        while (currentTime - startTime <= timeout) {
            const elementExists = await page.evaluate((jsPath) => {
                const element = eval(jsPath);
                return Boolean(element);
            }, jsPath);
    
            if (elementExists) {
                return;
            }
    
            // Wait for 100ms before checking again
            await page.waitForTimeout(100);
            currentTime = new Date().getTime();
        }
    
        throw new Error(`Timed out after ${timeout} ms waiting for element with JS path: ${jsPath}`);
    }    
    async performActionAndMeasureDuration(page, action, harFilePath, traceFilePath) {
        try {
            let actionFunction;
            let instanceUrl = action.Url;
            let numberOfCycles = action.numberOfCycles || 1; // Default to 1 cycle if numberOfCycles is not defined
            console.log(numberOfCycles);
            const reloadPageOnError = async (error) => {
                console.error('Error detected:', error);
                console.log('Reloading the page...');
                await page.reload();
            };

            page.on('error', reloadPageOnError);

            for (let i = 0; i < numberOfCycles; i++) {
                console.log(`Enterling loop inside ${action}...`);

                if (action.type === 'login') {
                    const isLoggedIn = await this.checkLoggedIn(page, instanceUrl, this.loopCount);
                    if (!isLoggedIn) {
                        actionFunction = () => this.loginToInstance(page, instanceUrl, action.username, action.password, action.waitUntilurlPattern, action.waitFor);
                    } else {
                        console.log('Already logged in.');
                    }
                }
                else if (action.type === 'navigate') {
                    actionFunction = () => this.navigate(page, action.Url, action.waitUntilurlPattern, action.waitFor, harFilePath, traceFilePath);
                }
                else if (action.type === 'click') {
                    actionFunction = () => this.clickButton(page, action.selector, action.selector2, action.waitUntilurlPattern, harFilePath, traceFilePath);

                }
                else if (action.type === 'clickButtonAndNavigate') {
                    actionFunction = () => this.clickButtonAndNavigate(page, action.selector, action.waitUntilurlPattern, harFilePath, traceFilePath);

                }
                else if (action.type === 'clickAndType') {
                    actionFunction = () => this.clickAndType(page, action.selector, action.text, this.testId, harFilePath, traceFilePath);

                }
                else if (action.type === 'clickAndchoose') {
                    actionFunction = () => this.clickAndchoose(page, action.selector, action.selector2, harFilePath, traceFilePath);

                }
                else if (action.type === 'logout') {
                    if (action.logoutEachloop == true) {
                        actionFunction = () => this.logoutOfInstance(page, action.Url);
                    }
                    else if (action.logoutEachloop == false && this.currentLoop == this.loopCount) {
                        actionFunction = () => this.logoutOfInstance(page, action.Url);
                    }
                }
                const startTime = Date.now();
                if (actionFunction) {
                    await actionFunction();
                }
                const endTime = Date.now();
                const duration = endTime - startTime;
                const lighthouseMetrics={};
               // const lighthouseMetrics = await this.runLighthouse(page);
                lighthouseMetrics.duration = duration;
                return lighthouseMetrics ;
                return duration;
            }
        } catch (error) {
            console.error('Error in performActionAndMeasureDuration:', error);
            throw new ServiceNowPerformanceTestError('Unable to performActionAndMeasureDuration ');
        }
    }

    async loginToInstance(page, instanceUrl, username, password, waitUntilurlPattern, waitFor) {
        await page.goto(instanceUrl + '/login.do');
        await page.type('#user_name', username);
        await page.type('#user_password', password);

        try {
            if (waitFor === 'specific' && waitUntilurlPattern != null ) {
                const loginstartTime = Date.now();
                await Promise.all([
                    page.waitForResponse(response => {
                        return response.url().match(waitUntilurlPattern);
                    }),
                    page.click('#sysverb_login'),
                ]).catch(error => {
                    throw new ServiceNowPerformanceTestError(`Error during login: ${error.message}`);
                });
            } else if (waitFor === 'networkidle') {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2' }),
                    page.click('#sysverb_login'),
                ]).catch(error => {
                    throw new ServiceNowPerformanceTestError(`Error during login: ${error.message}`);
                });
            } else {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'load' }),
                    page.click('#sysverb_login'),
                ]).catch(error => {
                    throw new ServiceNowPerformanceTestError(`Error during login: ${error.message}`);
                });
            }
        }
        catch (error) {
            console.error('Error in login:', error);
            throw error;
        }
    }

    async navigate(page, url, waitUntilurlPattern, waitFor) {
        if (!page || !url || !waitFor) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for navigate method');
        }

        try {
            if (waitFor === 'specific') {
                await Promise.all([
                    page.waitForResponse(response => {
                        return response.url().match(waitUntilurlPattern);
                    }),
                    page.goto(url),
                ]).catch(error => {
                    throw new ServiceNowPerformanceTestError(`Error during navigation: ${error.message}`);
                });
            } else if (waitFor === 'networkidle') {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2' }),
                    page.goto(url),
                ]).catch(error => {
                    throw new ServiceNowPerformanceTestError(`Error during navigation: ${error.message}`);
                });
            } else {
                throw new ServiceNowPerformanceTestError(`Invalid value for waitFor: ${waitFor}`);
            }
        } catch (error) {
            throw new ServiceNowPerformanceTestError(`Error in navigate: ${error.message}`);
        }
    }

/*    async clickAndType(page, chainedSelector) {

        if (!page || !chainedSelector) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for clickButton method');
        }

        try {
            await page.evaluate((chainedSelector) => {
                const button = eval(chainedSelector);
                if (button) {
                    button.click();
                } else {
                    throw new ServiceNowPerformanceTestError(`Button not found with selector: ${chainedSelector}`);
                }
            }, chainedSelector);
            await page.type("Description Sample");

            await page.waitForResponse(response => {
                return response.url().match(waitUntilurlPattern);
            }).catch(error => {
                throw new ServiceNowPerformanceTestError(`Error waiting for response after click: ${error.message}`);
            });     
        } catch (error) {
            console.error(`Error in clickButton: ${error.message}`);
            throw error;
        }
    } */

    async clickAndType(page, chainedSelector, text, harFilePath) {

        if (!page || !chainedSelector || !text) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for clickAndType method');
        }
    
        try {
            await page.evaluate((chainedSelector, text) => {
                const input = eval(chainedSelector);
                if (input) {
                    input.click();
                    input.value = text + Date.now();
                    input.dispatchEvent(new Event('blur', { bubbles: true }));
                    input.dispatchEvent(new Event('focus', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.click();
                } else {
                    throw new ServiceNowPerformanceTestError(`Element not found with selector: ${chainedSelector}`);
                }
            }, chainedSelector, text);
    
        } catch (error) {
            console.error(`Error in clickAndType: ${error.message}`);
            throw error;
        }
    }
    
    async clickButton(page, chainedSelector, chainedSelector2, waitUntilurlPattern) {

        if (!page || !chainedSelector ) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for clickButton method');
        }

        try {
            await page.evaluate((chainedSelector) => {
                const button = eval(chainedSelector);
                console.log(button);
                if (button) {
                    button.click();
                    console.log(button);
                } else {
                    throw new ServiceNowPerformanceTestError(`Button not found with selector: ${chainedSelector}`);
                }
            }, chainedSelector);
             //await waitForJsPath(page, 'nextJsPath');
             await page.waitForResponse(response => {
             return response.url().match(waitUntilurlPattern);
             }).catch(error => {
                 throw new ServiceNowPerformanceTestError(`Error waiting for response after click: ${error.message}`);
            });     
        } catch (error) {
            console.error(`Error in clickButton: ${error.message}`);
            throw error;
        }
    } 

    async clickButtonAndNavigate(page, chainedSelector, waitUntilurlPattern) {

        if (!page || !chainedSelector ) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for clickButton method');
        }

        try {
            await page.evaluate((chainedSelector) => {
                const button = eval(chainedSelector);
                console.log(button);
                if (button) {
                    button.click();
                    console.log(button);
                } else {
                    throw new ServiceNowPerformanceTestError(`Button not found with selector: ${chainedSelector}`);
                }
            }, chainedSelector);
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(error => {
             throw new ServiceNowPerformanceTestError(`Error waiting for network idle after click: ${error.message}`);
            });     
        } catch (error) {
            console.error(`Error in clickButton: ${error.message}`);
            throw error;
        }
    } 


    async clickAndchoose(page, chainedSelector1, chainedSelector2, waitUntilurlPattern) {

        if (!page || !chainedSelector1 ) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for clickButton method');
        }

        try {
            await page.evaluate((chainedSelector1) => {
                const button = eval(chainedSelector1);
                console.log(button);
                if (button) {
                    button.click();
                    console.log(button);
                } else {
                    throw new ServiceNowPerformanceTestError(`Button not found with selector: ${chainedSelector1}`);
                }
            }, chainedSelector1);
            await new Promise(r => setTimeout(r, 2000));
            console.log(chainedSelector2);
            await page.evaluate((chainedSelector2) => {
                const button = eval(chainedSelector2);
                console.log(button);
                if (button) {
                    button.click();
                    console.log(button);
                } else {
                    throw new ServiceNowPerformanceTestError(`Button not found with selector: ${chainedSelector2}`);
                }
            }, chainedSelector2);   
        } catch (error) {
            console.error(`Error in clickButton: ${error.message}`);
            throw error;
        }
    }

    async appendTimingToCSV(suiteId, testId, currentLoop, actionName, actionType, actionUrl, duration) {
        const lineProtocolFileName = 'line_protocol.txt';
        const lineProtocolFilePath = path.join(this.folderPath, lineProtocolFileName);
        const durationLineProtocol = this.formatDurationForLineProtocol(duration);

    
        const csvFileName = 'timings.csv';
        const csvFilePath = path.join(this.folderPath, csvFileName);
    
        const durationHeaders = this.getDurationHeaders(duration);
        const durationValues = this.getDurationValues(duration);
    
        const csventry = `${this.suiteId},${testId},${this.SpeedometerScore},${this.OctaneScore},${currentLoop},${actionName},${actionType},${actionUrl},${durationValues}\n`;
    
        const timestamp = Date.now() * 1000000; // Convert to nanoseconds
        const entry = `performance_test,suiteId=${this.suiteId},testID=${testId},actionName=${actionName},actionType=${actionType},url=${actionUrl},speedometerScore="${this.SpeedometerScore}",octaneScore="${this.OctaneScore}",numLoop=${currentLoop},${durationLineProtocol} ${timestamp}\n`;
    
        // Check if the file exists, and if not, create it
        if (!fs.existsSync(lineProtocolFilePath)) {
            fs.writeFileSync(lineProtocolFilePath, '');
        }
    
        // Append the entry to the line protocol file
        fs.appendFileSync(lineProtocolFilePath, entry);
    
        // Check if the file exists, and if not, add the header
        if (!fs.existsSync(csvFilePath)) {
            const header = `SuiteId,TestID,SpeedometerScore,OctaneScore,NumLoop,ActionName,ActionType,URL,${durationHeaders}\n`;
            fs.writeFileSync(csvFilePath, header);
        }
    
        // Append the entry to the CSV file
        fs.appendFileSync(csvFilePath, csventry);
    }
    
    computeStatistics(data) {
        if (!data || data.length === 0) {
            return {
                avg: 0,
                min: 0,
                max: 0,
                median: 0,
                p90: 0
            };
        }
    
        data.sort((a, b) => a - b);
        const sum = data.reduce((a, b) => a + b, 0);
        const avg = sum / data.length;
        const min = data[0];
        const max = data[data.length - 1];
        const median = data.length % 2 === 0 ? (data[(data.length / 2) - 1] + data[data.length / 2]) / 2 : data[Math.floor(data.length / 2)];
        const p90 = data[Math.floor(data.length * 0.9)];
    
        return {
            avg,
            min,
            max,
            median,
            p90
        };
    }
    
    parseCSVRow(row) {
        const regex = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
        let arr = [];
        row.replace(regex, function (m0, m1, m2, m3) {
            if      (m1 !== undefined) arr.push(m1.replace(/\\'/g, "'"));
            else if (m2 !== undefined) arr.push(m2.replace(/\\"/g, '"'));
            else if (m3 !== undefined) arr.push(m3);
            return '';
        });
        return arr;
    }
    
    computeStatsFromCSV(inputFilePath, outputFilePath) {
        const csvData = fs.readFileSync(inputFilePath, 'utf-8');
        const rows = csvData.split('\n').filter(row => row.trim() !== '');
        const headers = this.parseCSVRow(rows[0]);
        const metrics = ['duration', 'speedIndex'];
    
        let actionNameGroups = {};
    
        rows.slice(1).forEach(row => {
            const parsedRow = this.parseCSVRow(row);
            const data = {};
            parsedRow.forEach((value, index) => {
                data[headers[index]] = value;
            });
        
            let actionName = data['ActionName'];
        
            metrics.forEach(metric => {
                let value = parseFloat(data[metric]);
        
                if (!actionNameGroups[actionName]) {
                    actionNameGroups[actionName] = {};
                }
        
                if (!actionNameGroups[actionName][metric]) {
                    actionNameGroups[actionName][metric] = [];
                }
        
                if (!isNaN(value)) {
                    actionNameGroups[actionName][metric].push(value);
                }
            });
        });
        
    
        let statsByActionName = {};
        for (let actionName in actionNameGroups) {
            statsByActionName[actionName] = {};
            metrics.forEach(metric => {
                statsByActionName[actionName][metric] = this.computeStatistics(actionNameGroups[actionName][metric]);
            });
        }
    
        let csvOutput = 'ActionName,Metric,Average,Min,Max,Median,P90\n';
        for (let actionName in statsByActionName) {
            metrics.forEach(metric => {
                csvOutput += `${actionName},${metric},${statsByActionName[actionName][metric].avg},${statsByActionName[actionName][metric].min},${statsByActionName[actionName][metric].max},${statsByActionName[actionName][metric].median},${statsByActionName[actionName][metric].p90}\n`;
            });
        }
        outputFilePath = path.join(this.folderPath,outputFilePath);
        fs.writeFileSync(outputFilePath, csvOutput);
    }
    

    // This function will extract headers from the duration object and format them
    getDurationHeaders(duration) {
        return Object.keys(duration).map(key => key.replace('.', '_')).join(',');
    }
    
    // This function will extract values from the duration object and handle undefined values
    getDurationValues(duration) {
        return Object.values(duration).map(value => value !== undefined ? value : 'null').join(',');
    }

    // This function will extract key-value pairs from the duration object, handle undefined values, and format them for line protocol
    formatDurationForLineProtocol(duration) {
    return Object.entries(duration)
        .map(([key, value]) => {
            const formattedKey = key.replace('.', '_'); // Assuming dots are not allowed in the line protocol
            const formattedValue = value !== undefined ? value : 'null';
            return `${formattedKey}="${formattedValue}"`;
        })
        .join(',');
    }

    async  checkLoggedIn(page, instanceUrl, cycle) {
        let instanceName = testProperties.testSettings.instanceName;
        if (!page || !instanceUrl || !cycle) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for checkLoggedIn method');
        }

        try {
            if (cycle > 2 ) {
                await page.goto(`https://${instanceName}.service-now.com/stats.do`);
                await page.waitForSelector('body');
                const bodyText = await page.evaluate(() => document.querySelector('body').innerText);
                return bodyText.includes('Statistics for');
            }
            else return false;
        }
        catch (error) {
            console.error('Error in checkLoggedIn:', error);
            throw new ServiceNowPerformanceTestError('Unable to check if user is logged in');
        }
    }

    async logoutOfInstance(page, instanceUrl) {
        if (!page || !instanceUrl) {
            throw new ServiceNowPerformanceTestError('Invalid input parameters for logoutOfInstance method');
        }
        try {
            await page.goto(instanceUrl + 'logout.do');
        } catch (error) {
            console.error('Error in logoutOfInstance:', error);
            throw new ServiceNowPerformanceTestError('Unable to log out of the instance');
        }
    }

    async launchBrowser() {
        const browser = await puppeteer.launch({
            headless: testProperties.helperConfig.headless,
            timeout: testProperties.helperConfig.timeout, // Increase the timeout to 60 seconds
            slowMo: testProperties.helperConfig.slowMo, // Slow down the execution by 100ms
            defaultViewport: testProperties.helperConfig.defaultViewport, // Use the default viewport size of the browser
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add these lines
        });
        return browser; // Add return statement here
    }
    
    async openNewPage(browser) {
        if (!browser) {
            throw new ServiceNowPerformanceTestError('Invalid browser instance for openNewPage method');
        }
        try {
            const page = await browser.newPage();
            const throttleEnabled = testProperties.throttleConfig.throttle;
            const client = await page.target().createCDPSession();
            if (throttleEnabled) {
                await client.send('Network.emulateNetworkConditions', {
                    offline: testProperties.throttleConfig.network.offline,
                    latency: testProperties.throttleConfig.network.latency,
                    downloadThroughput: testProperties.throttleConfig.network.downloadThroughput * 1024 * 1024 / 8,
                    uploadThroughput: testProperties.throttleConfig.network.uploadThroughput * 1024 / 8,
                });
               // await client.send('Emulation.setCPUThrottlingRate', { rate: testProperties.throttleConfig.cpu.rate });
            }
            return page;
        } catch (error) {
            console.error('Error in openNewPage:', error);
            throw new ServiceNowPerformanceTestError('Unable to open a new page');
        }
    }

    readActionsFromFile(filepath) {
     let instanceName = testProperties.testSettings.instanceName;
     let username = testProperties.testSettings.username;
     let password = testProperties.testSettings.password;
        try {
            const fileContent = fs.readFileSync(filepath, 'utf8');
            let modifiedFileContent = fileContent.replace(/{{INSTANCE}}/g, instanceName);
            modifiedFileContent = modifiedFileContent.replace(/{{username}}/g, username);
            modifiedFileContent = modifiedFileContent.replace(/{{password}}/g, password);
            const actions = JSON.parse(modifiedFileContent);
            return actions;
        } catch (error) {
            console.error(`Error reading actions from file: ${error.message}`);
            throw error;
        }
    }

    generateSuiteId(suiteName) {
        try {
            // Create a SHA-256 hash of the suiteName
            const hash = crypto.createHash('sha256');
            hash.update(suiteName);
            const hashedSuiteName = hash.digest('hex');
    
            // Convert the hash to a number (base 10)
            let hashAsBigInt = BigInt('0x' + hashedSuiteName);
            hashAsBigInt = hashAsBigInt % BigInt(1e8);  // Limit the number to 8 digits
    
            // Convert the number back to a string and pad with zeros if necessary
            let currentId = hashAsBigInt.toString();
            currentId = currentId.padStart(8, '0');
    
            // Generate the suite id    
            this.suiteId = 'SPT' + currentId;
            console.log(this.suiteId);
            return this.suiteId;
        } catch (error) {
            console.error('Error in generateSuiteId:', error);
            throw new Error('Unable to generate suite ID');
        }
    }

    generateTestId() {
        try {
            const timestamp = Date.now();
            const randomString = crypto.randomBytes(8).toString('hex');
            const hash = crypto.createHash('sha256').update(timestamp + randomString).digest('hex');

            return 'test_' + hash;
        } catch (error) {
            console.error('Error in generateTestId:', error);
            throw new ServiceNowPerformanceTestError('Unable to generate test ID');
        }
    }

    createFolderWithTestId(folderPath) {
        if (!fs.existsSync(this.folderPath)) {
            fs.mkdirSync(this.folderPath);
        }
        return this.folderPath;
    }

    async closeBrowser(browser) {
        try {
            await browser.close();
        } catch (error) {
            console.error('Error in closeBrowser:', error);
            throw new ServiceNowPerformanceTestError('Unable to close browser');
        }
    }

    async runSpeedometerBenchmark(page) {
        // Navigate to the Speedometer benchmark page
        await page.goto('https://browserbench.org/Speedometer/', { waitUntil: 'networkidle2' });
        // Click the "Start Test" button
        await Promise.all([
            page.click('#home > div'),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
        ]);
        const resultSelector = '#result-number';
        await page.waitForSelector(resultSelector, { timeout: 60000 }); // Adjust the timeout value as needed
        const score = await page.$eval(resultSelector, el => parseFloat(el.textContent.trim()));
        return score;
    }

    async runOctaneBenchmark(page) {
        // Navigate to the Octane 2.0 benchmark page
        await page.goto('https://chromium.github.io/octane/', { waitUntil: 'networkidle0', timeout: 60000 });
        // Click the "Start Octane" button
        await Promise.all([
            page.waitForFunction(
                'window.document.getElementById("main-banner").innerText.includes("Octane Score:")',
                { timeout: 60000 }
            ),
            page.click('#run-octane'),
        ]);

        // Extract the score
        const score = await page.$eval('#main-banner', (el) => {
            const text = el.textContent.trim();
            const match = text.match(/Octane Score: (\d+)/);
            if (match) {
                return parseInt(match[1], 10);
            } else {
                throw new Error('Unable to extract Octane score');
            }
        });
        return score;
    }

    getWaterfallChartFiles(folderPath) {
        const files = readdirSync(folderPath, { withFileTypes: true })
          .filter((file) => file.isFile() && file.name.endsWith('.har'))
          .map((file) => {
            const filePath = path.join(folderPath, file.name);
            const stat = fs.statSync(filePath);
            return {
              filePath,
              created: stat.birthtime,
            };
          })
          .sort((a, b) => a.created - b.created)
          .map((file) => file.filePath);
        return files;
    }
      
    csvToHtmlTable(csvString) {
        const lines = csvString.split('\n');
        const headers = lines[0].split(',');
      
        const table = `<table>
          <thead>
            <tr>
              ${headers.map((header) => `<th>${header}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${lines.slice(1).map((line) => {
          const row = line.split(',');
          return `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
        }).join('')}
          </tbody>
        </table>`;
        return table;
    }            

    generateReport(folderPath) {
      
        // Parse the HTML template
        const dom = new JSDOM('<!DOCTYPE html><html><head><title>Performance Report</title></head><body><h1>Service Now Performance Test Report</h1><div id="additional-html-container"></div></body></html>');
        const reportDoc = dom.window.document;
        const additionalHtmlContainer = reportDoc.querySelector('#additional-html-container');
        
        // Read the timings CSV file and convert it to an HTML table
        const timingsCsvPath = path.join(folderPath, 'timings.csv');
        const timingsCsvString = fs.readFileSync(timingsCsvPath, 'utf-8');
        const timingsTable = this.csvToHtmlTable(timingsCsvString);
        
        // Add timings table to html
        const chartWrapper = reportDoc.createElement('div');
        chartWrapper.innerHTML = `<div class="csv-data">${timingsTable}</div>`;
        additionalHtmlContainer.appendChild(chartWrapper);

        // Get the waterfall chart files
        const waterfallChartFiles = this.getWaterfallChartFiles(folderPath);
        
        // Insert the waterfall charts and CSV data into the final report
        waterfallChartFiles.forEach((chartFilePath) => {
          let originalChartFilePath = chartFilePath;
          chartFilePath = chartFilePath.replace('.har', '_waterfall_chart.html');
      
          // Check if the waterfall chart HTML file exists
          if (!fs.existsSync(chartFilePath)) {
            console.log(`Waterfall chart file ${chartFilePath} does not exist. Skipping.`);
            return;  // Skip to the next chartFilePath
          }
      
          let chartHtml;
          try {
            chartHtml = fs.readFileSync(chartFilePath, 'utf-8');
          } catch (err) {
            console.error(`Error reading file ${chartFilePath}: ${err}`);
            return;  // Skip to the next chartFilePath
          }
      
          const chartDom = new JSDOM(chartHtml);
          const chartTitle = chartFilePath.match(/([a-zA-Z0-9_]+)_waterfall_chart/)[1];
          const chartContent = chartDom.window.document.body.innerHTML;
      
          const csvFilePath = chartFilePath.replace('waterfall_chart.html', 'waterfall_data.csv');
          const csvString = fs.readFileSync(csvFilePath, 'utf-8');
          const csvTable = this.csvToHtmlTable(csvString);
      
          // Add PNG hyperlink
          const pngFilePath = chartFilePath.replace('_waterfall_chart.html', '.png');
          const pngHyperlink = `<a href="${pngFilePath}" target="_blank">View Screenshot</a>`;

          // Add Video hyperlink
          const videoFilePath = chartFilePath.replace('_waterfall_chart.html', '.mp4');
          const videoHyperlink = `<a href="${videoFilePath}" target="_blank">View ScreenRecording</a>`;
      
          // Add waterfall chart hyperlink
          const chartHyperlink = `<a href="${chartFilePath}" target="_blank">View Waterfall Chart</a>`;
      
          const chartWrapper = reportDoc.createElement('div');
          chartWrapper.innerHTML = `
            <h2>${chartTitle}</h2>
            <div class="chart">${chartHyperlink}</div>
            <div class="csv-data">${csvTable}</div>
            <div class="screenshot-link">${pngHyperlink}</div>
            <div class="screenshot-link">${videoHyperlink}</div>`;

          additionalHtmlContainer.appendChild(chartWrapper);
        });
      
        // Generate the final report HTML
        const reportHtml = reportDoc.documentElement.outerHTML;
      
        // Save the report to a file
        const reportOutputPath = path.join(this.folderPath, 'performance_report.html');
        fs.writeFileSync(reportOutputPath, reportHtml, 'utf-8');
        console.log(`Performance report saved to: ${this.folderPath}`);
    }
}
