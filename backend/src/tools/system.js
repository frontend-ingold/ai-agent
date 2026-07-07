export async function system(operation) {

    switch (operation) {

        case "datetime":

            return {

                success: true,

                tool: "system",

                result: {

                    date: new Date().toLocaleDateString(),

                    time: new Date().toLocaleTimeString()

                }

            };

        default:

            return {

                success: false,

                error: "Unknown operation"

            };

    }

}