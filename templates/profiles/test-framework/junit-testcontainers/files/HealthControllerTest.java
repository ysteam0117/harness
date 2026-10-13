package {{java_package}}.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

/** Controller だけを起動して確かめる（Docker は要らない）。 */
@WebMvcTest(value = HealthController.class, properties = "app.env=test")
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthは状態とappEnvを返す() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.appEnv").value("test"));
    }
}
