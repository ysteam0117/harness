package {{java_package}};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/** アプリ全体を起動して、設定の誤りで起動に失敗しないことを確かめる（Docker は要らない）。 */
@SpringBootTest
class ApplicationTests {

    @Test
    void contextLoads() {
    }
}
