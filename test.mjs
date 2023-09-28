
import ServiceNowPerformanceTestHelper from './ServiceNowPerformanceHelper.mjs';
import ServiceNowPerformanceTestError from './ServiceNowPerformanceHelper.mjs';
import testProperties from './testProperties.json' assert { type: 'json' };


const handledExceptions = [
    'Session already detached. Most likely the page has been closed',
    'TimeoutError: waiting for target failed: timeout 60000ms exceeded',
    'TimeoutError: Navigation timeout of',
    'ProtocolError: Protocol error (Page.enable): Target crashed',
    'ProtocolError: Page.enable timed out',
    'Error: Navigation failed because browser has disconnected',
    'Error: net::ERR_TIMED_OUT at',
    'Error clicking the button with selector',
    'TimeoutError: Waiting for selector',
    'Error: Protocol error (Page.navigate): Session closed'
];

async function browserWrapperFunction(performanceTester, actions) {
    const maxRetries = testProperties.testSettings.maxRetries;
    const scoreflag = testProperties.testSettings.scoreflag;
    let retryCount = 0;
    let success = false;
    let speedometerResult;
    let octaneResult;
    while (!success && retryCount < maxRetries) {
        try {
            console.log('Launching browser...');
            const browser = await performanceTester.launchBrowser(); // Store the result in a variable
            console.log('Browser launched.');
            console.log('Opening new page...');
            const page = await performanceTester.openNewPage(browser);
            console.log('New page opened.');
            console.log('scoreflag value:', scoreflag);
            // Run Speedometer benchmark
            if(scoreflag){            
            console.log('Running Speedometer benchmark...');
            speedometerResult = await performanceTester.runSpeedometerBenchmark(page);
            console.log(`Speedometer result: ${speedometerResult}`);
            }
            // Run Octane 2.0 benchmark
            if(scoreflag){
            console.log('Running Octane 2.0 benchmark...');
            octaneResult = await performanceTester.runOctaneBenchmark(page);
            console.log(`Octane 2.0 result: ${octaneResult}`);
            }
            await performanceTester.executeActionsAcrossIterations(page, actions,speedometerResult,octaneResult);
            await performanceTester.closeBrowser(browser);
            success = true;
        } catch (error) {
            const isHandledException = handledExceptions.some((exception) => {
                if (typeof exception === 'string') {
                    return error.message.includes(exception) || exception.includes(error.message);
                } else {
                    return error instanceof exception;
                }
            }) || error instanceof ServiceNowPerformanceTestError;

            if (isHandledException) {
                console.error(`Error occurred: ${error.message}`);
                retryCount++;
                console.log(`Retry ${retryCount} of ${maxRetries}...`);
            } else {
                console.error('Unhandled error occurred:', error);
                throw error;
            }
        }
    }

    if (!success) {
        console.error(`All ${maxRetries} retries failed.`);
    }
}

(async () => {
    const performanceTester = new ServiceNowPerformanceTestHelper();
    const actionsFilePath = testProperties.testSettings.actionsFilePath;
    let actions = performanceTester.readActionsFromFile(actionsFilePath);
    console.log(actions);
    process.env.DEBUG = 'puppeteer:*'; // Enable Puppeteer debugging
    await browserWrapperFunction(performanceTester, actions);
})();