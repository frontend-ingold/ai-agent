import "dotenv/config";

const API_URL = "https://api.tavily.com/search";

export async function tavilySearch(query) {

    try {

        const response = await fetch(API_URL, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                api_key: process.env.TAVILY_API_KEY,

                query,

                search_depth: "advanced",

                include_answer: true,

                include_images: false,

                include_raw_content: false,

                max_results: 5

            })

        });

        if (!response.ok) {

            throw new Error(`HTTP ${response.status}`);

        }

        return await response.json();

    } catch (err) {

        return {

            success: false,

            error: err.message

        };

    }

}