package {{java_package}}.health;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 動作の確認用の API。画面の「サーバーの状態」の表示が呼ぶ。Controller は入力の受付と応答だけにする。 */
@RestController
public class HealthController {

    /** 応答の形。画面の Health 型（status・appEnv）と合わせる。 */
    public record HealthResponse(String status, String appEnv) {}

    private final String appEnv;

    public HealthController(@Value("${app.env}") String appEnv) {
        this.appEnv = appEnv;
    }

    @GetMapping("/api/health")
    public HealthResponse health() {
        return new HealthResponse("ok", appEnv);
    }
}
